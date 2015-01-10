class SourceManager {
  constructor(videoEl, mpd) {
    this.videoEl = videoEl
    this.msrc = new MediaSource()
    this.msrc.sourceManager = this
    this.msrc.mpd = mpd
    this.msrc.addEventListener('sourceopen', this.onSourceOpen)
    this.events()
    // this triggers the 'sourceopen' event.
    this.videoEl.src = URL.createObjectURL(this.msrc)
    this.loadBeginningSegs = function(e) {
      var buf = e.target

      var rep = buf.rep
      var seg =  rep.segments[0];
      var time = seg.t
      var url = rep.BaseURL + this.replaceTimeToken(rep.segmentURLTemplate, time)
      buf.last_duration = seg.d/rep.timescale
      this.requestSegementDownload(buf, url, time)
      // Remove the event listener to load first data segment
      // as we don't need it anymore.
      buf.removeEventListener('update', this.loadBeginningSegs)

    }.bind(this)
  }

  events() {
    var videoEl = this.videoEl

    videoEl.addEventListener("timeupdate",
       this.isTimeFordownloadSegment.bind(this));

    videoEl.addEventListener("seeking",
       this.seek.bind(this));

    // Remove the handler for the timeupdate event
    videoEl.addEventListener("ended", () =>
      videoEl.removeEventListener("timeupdate", this.isTimeFordownloadSegment));
  }

  seek() {
     _.each(this.msrc.activeBufs, function(buf, index, list) {
       buf.last_duration = this.videoEl.currentTime - 1
       this.resetSourceBuffer(buf, 'seeked')
    }, this);
    this.isTimeFordownloadSegment.bind(this)(this.videoEl.currentTime)
  }

  resetSourceBuffer(buf, reason) {
    if (buf.xhr != null) {
      buf.xhr.abort();
      buf.xhr = null;
    }
    buf.reset_reason = reason || null;
    if (this.msrc.readyState != 'open') return;
    buf.abort();
  }

  isTimeFordownloadSegment() {
    console.log('RS ' + this.videoEl.readyState)
    var currentTime = this.videoEl.currentTime
    console.log('time changed')
    console.log(currentTime)
    console.log(this)

    _.each(this.msrc.activeBufs, function(buf, index, list) {

      var range = this.findRangeForPlaybackTime(buf, currentTime);
      var append_time = (range && range.end) || currentTime;
      if (append_time > time + 15) return;
      var rep = buf.rep
      for (var i = 0, last_duration=0, time=0; i < rep.segments.length; i++) {
        var s = rep.segments[i];
        console.log(last_duration)
        console.log('s/t: ' + s.d/rep.timescale)
        console.log('append time: ' + append_time)
        console.log( append_time)
        console.log(buf)
        if (last_duration + s.d/rep.timescale > append_time) {
          console.log('Time seeked to: ' + append_time);
          this.downloadForTimedData(buf, time)
          return
        }
        last_duration += s.d/rep.timescale
        time += s.d
      }

    }, this)

  }

  findRangeForPlaybackTime(buf, time) {
    console.log('pbt')
    console.log(buf)
    console.log(time)
    var ranges = buf.buffered;
    for (var i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= time && ranges.end(i) >= time) {
        return {'start': ranges.start(i), 'end': ranges.end(i)};
      }
    }
  }


  downloadForTimedData(buf, time) {
    var rep = buf.rep
    var url = rep.BaseURL + this.replaceTimeToken(rep.segmentURLTemplate, time)
    buf.last_duration = buf.last_duration + time/rep.timescale
    this.requestSegementDownload(buf, url, time)
  }

  updateBuffer(buf, value) {
    // Add to buf.queue if the buf is updating
    // or else append to buffer.
    // data in buf.queue is appended by the
    // updateend event handler registered on buf.
    if (buf.updating) {
      buf.queue.push(value);
    } else {
      buf.appendBuffer(value);
      if(this.videoEl.readyState < this.videoEl.HAVE_FUTURE_DATA) {
        console.log('data less than future')
        this.isTimeFordownloadSegment()
      }
    }
  }

  onSourceOpen(e) {
    var msrc = this
    var sourceManager = msrc.sourceManager
    var mpd = msrc.mpd
    msrc.duration = mpd.Period.duration || mpd.mediaPresentationDuration
    msrc.activeBufs = []

    for (var i = 0; i < mpd.Period.AdaptationSet_asArray.length; i++) {
      var aset = mpd.Period.AdaptationSet[i];
      var reps = aset.Representation_asArray.map(sourceManager.normalizeRepresentation.bind(sourceManager, mpd));
      var mime = reps[0].mimeType || aset.mimeType;
      var codecs = reps[0].codecs || aset.codecs;
      console.log(codecs)
      var buf = msrc.addSourceBuffer(mime + '; codecs="' + codecs + '"');
      buf.aset = aset;    // Full adaptation set, retained for reference
      buf.rep = reps[0];    // Individual normalized representations
      buf.active = true;  // Whether this buffer has reached EOS yet
      buf.mime = mime;
      buf.queue = [];
      buf.downloaded = []
      buf.addEventListener('updateend', sourceManager.addFromQueue.bind(buf));
      msrc.activeBufs.push(buf)
      sourceManager.loadInit(buf)
    }

  }

  normalizeRepresentation(mpd, repSrc) {
    repSrc.duration = mpd.mediaPresentationDuration
    repSrc.init = this.replaceRepresentationToken(repSrc.SegmentTemplate.initialization, repSrc)
    repSrc.segmentURLTemplate = this.replaceRepresentationToken(repSrc.SegmentTemplate.media, repSrc)
    repSrc.segments = repSrc.SegmentTemplate.SegmentTimeline.S
    repSrc.timescale = repSrc.SegmentTemplate.timescale
    return repSrc;
  }

  replaceRepresentationToken(url, rep) {
    return url.replace('$RepresentationID$', rep.id);
  }

  replaceTimeToken(template, time) {
    var url = template.replace('$Time$', time);
    return url;
  }



  addFromQueue() {
    // called in the context of the updated buffer.
    // handles adding data to buf from the queue
    if (this.queue.length) {
      this.appendBuffer(this.queue.shift());
    }
  }


  //  Load initialization segment
  loadInit(buf) {
    var rep = buf.rep
    var url =  rep.BaseURL + rep.init
    this.requestSegementDownload(buf, url, 'init')

    // add a new event listner to download first data segment after
    // init segment is loaded
    buf.addEventListener('update', this.loadBeginningSegs)


    // download the first segment (time 0) for quick play

  }

  requestSegementDownload(buf, url, part) {
    if(_.contains(buf.downloaded, part)) return
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = 'arraybuffer'
    xhr.buf = buf
    xhr.addEventListener('load',
      this.processSegmentDownload.bind(this))
    buf.xhr = xhr
    buf.downloaded.push(part)
    xhr.send()
  }

  processSegmentDownload(e) {
    var xhr = e.target
    var buf = xhr.buf
    buf.xhr = null

    if (xhr.readyState != xhr.DONE) return

    if (xhr.status >= 300) {
      throw 'TODO: retry XHRs on failure'
    }

    this.updateBuffer(buf, xhr.response);

  }

  downloadSegment() {

  }


}
module.exports = SourceManager
