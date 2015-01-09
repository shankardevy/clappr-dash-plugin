var Playback = require('playback')
var JST = require('../jst')
var DashParser = require('./dash.js/DashParser');
// var Mousetrap = require('mousetrap')
//var seekStringToSeconds = require('base/utils').seekStringToSeconds

var _ = require('underscore')


class ClapprDash extends Playback {

  get name() { return 'clappr_dash' }
  get tagName() { return 'video' }
  get template() { return JST.clappr_dash }

  get attributes() {
    return {
      'data-html5-video': ''
    }
  }

  get events() {
    return {
      'timeupdate': 'timeUpdated',
      'progress': 'progress',
      'canplaythrough': 'bufferFull',
      'stalled': 'stalled',
      'waiting': 'waiting'
    }
  }


  constructor(options) {
    super(options)
    var _this = this
    this.options = options
    this.el.loop = options.loop
    this.settings = {default: ['seekbar']}
    this.settings.left = ["playpause", "position", "duration"]
    this.settings.right = ["fullscreen", "volume"]
    this.settings.seekEnabled = true
    this.downloadedTimeframes = []
    window.v = this.el

    // Dash
    this.parser = new DashParser;
    this.retrieveDASHManifest.bind(this)(options.src);
  }

  retrieveDASHManifest(url) {
    var xhr = new XMLHttpRequest();
    xhr.addEventListener('load', this.onManifestLoad.bind(this, url));
    //xhr.addEventListener('error', onManifestError.bind(this, url));
    xhr.open("GET", url);
    xhr.send();
  }

  parseBaseUrl(url) {
    var base = null;

    if (url.indexOf("/") !== -1)
    {
      if (url.indexOf("?") !== -1) {
        url = url.substring(0, url.indexOf("?"));
      }
      base = url.substring(0, url.lastIndexOf("/") + 1);
    }

    return base;
  }

  onManifestLoad(url, evt) {
    var mpd, msrc
    mpd = this.parser.parse(evt.target.responseText, this.parseBaseUrl(url));
    msrc = new MediaSource();
    msrc.mpd = mpd
    msrc.addEventListener('sourceopen', this.onSourceOpen.bind(this));

    this.mpd = mpd
    this.msrc = msrc
    this.el.src = URL.createObjectURL(msrc);
  }

  onSourceOpen(evt) {
    var video = this.el
    var msrc = this.msrc
    var mpd = msrc.mpd

    if (!msrc.progressTimer) {
      msrc.progressTimer = window.setInterval(this.onProgress.bind(this, msrc), 500);
    }

    msrc.duration = mpd.Period.duration || mpd.mediaPresentationDuration;

    for (var i = 0; i < mpd.Period.AdaptationSet_asArray.length; i++) {
      window.mpd = mpd;
      var aset = mpd.Period.AdaptationSet[i];
      var reps = aset.Representation_asArray.map(this.normalizeRepresentation.bind(this, mpd));
      var mime = reps[0].mimeType || aset.mimeType;
      var codecs = reps[0].codecs || aset.codecs;
      var buf = msrc.addSourceBuffer(mime + '; codecs="' + codecs + '"');

      buf.aset = aset;    // Full adaptation set, retained for reference
      buf.rep = reps[0];    // Individual normalized representations
      buf.active = true;  // Whether this buffer has reached EOS yet
      buf.mime = mime;
      buf.queue = [];
      buf.SegIdx = 0;
      buf.nextSegDuration = 0;
      if (buf.appendBuffer) {
        buf.addEventListener('updateend', function(e) {
          if (buf.queue.length) {
            buf.appendBuffer(buf.queue.shift());
          }
        });
      }

    }
  }

  replaceRepresentationToken(url, rep) {
    return url.replace('$RepresentationID$', rep.id);
  }

  normalizeRepresentation(mpd, repSrc) {
    repSrc.duration = mpd.mediaPresentationDuration;
    repSrc.init = this.replaceRepresentationToken(repSrc.SegmentTemplate.initialization, repSrc);
    repSrc.segmentURLTemplate = this.replaceRepresentationToken(repSrc.SegmentTemplate.media, repSrc);
    repSrc.segments = repSrc.SegmentTemplate.SegmentTimeline.S;
    repSrc.timescale = repSrc.SegmentTemplate.timescale
    return repSrc;
  }

  onProgress(msrc) {

    if (msrc.readyState != 'open' && !!msrc.progressTimer) {
      window.clearInterval(msrc.progressTimer);
      msrc.progressTimer = null;
      return;
    }

    var active = false;
    for (var i = 0; i < msrc.sourceBuffers.length; i++) {
      var buf = msrc.sourceBuffers[i];
      if (!buf.active) continue;
      active = true;
      this.fetchNextSegment.bind(this)(buf, msrc);
    }

    if (!active && msrc.readyState == 'open') {
      msrc.endOfStream();
      return;
    }
  }

  fetchNextSegment(buf, msrc) {
    if (buf.xhr) return;
    window.buf = buf;
    var rep = buf.rep;
    var url, time;

    if (!buf.init_loaded) {
      url =  rep.BaseURL + rep.init;
      this.makeXHR(buf, url, 'init', true);
      return;
    }

    time = this.nextSegmentTime(rep, this.el)
    console.log('Requesting for: ' + time);

    url = rep.BaseURL + this.replaceTimeToken(rep.segmentURLTemplate, time);
    this.makeXHR(buf, url, time);
  }

  nextSegmentTime(rep, video) {
    var currentTime = video.currentTime
    console.log('Currenttime: ' + currentTime);

    for (var i = 0, last_duration=0, time=0; i < rep.segments.length; i++) {
      var s = rep.segments[i];
      if (last_duration <= currentTime && last_duration + s.d/rep.timescale >= currentTime) {
          console.log('Time seeked to: ' + time);
          return time;
      }
      last_duration += s.d/rep.timescale
      time += s.d
     }

  }

  resetSourceBuffer(buf, reason) {
    if (buf.xhr != null) {
      buf.xhr.abort();
      buf.xhr = null;
    }
    buf.url = null;
    buf.segIdx = null;
    buf.last_init = null;
    buf.reset_reason = reason || null;
    // Shame on me for using window.
    if (this.msrc.readyState != 'open') return;
    buf.abort();
  }

  makeXHR(buf, url, time, is_init) {
    console.log('XHR request initiated for ' + time);

    this.downloadedTimeframes[buf.mime] = this.downloadedTimeframes[buf.mime] || [];
    if(_.contains(this.downloadedTimeframes[buf.mime], time)) {
      console.log('XHR request skipped for ' + time);
      window.dbuf = this.downloadedTimeframes
      return
    }
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = 'arraybuffer';
    xhr.addEventListener('load', this.onXHRLoad.bind(this));
    xhr.buf = buf;
    xhr.time = time
    xhr.is_init = is_init;
    buf.xhr = xhr;
    xhr.send();
    return xhr;
  }

  onXHRLoad(evt) {
    var xhr = evt.target;
    var buf = xhr.buf;
    buf.xhr = null;
    var vid = buf.video;

    if (xhr.readyState != xhr.DONE) return;
    if (xhr.status >= 300) {
      throw 'TODO: retry XHRs on failure';
    }


    //xhr.init.value = new Uint8Array(xhr.response);

    this.queueAppend(buf, xhr.response);
    this.downloadedTimeframes[buf.mime].push(xhr.time)

    if (xhr.is_init) {
      buf.init_loaded = true;
    } else {
      buf.nextSegDuration = (function() {
        var duration  = 0;
        for(var i=0; i<=buf.SegIdx; i++) {
          duration += buf.rep.segments[i].d
        }
        return duration;
      }());

      buf.SegIdx++;

    }

    if (buf.SegIdx >= buf.rep.segments.length) {
      buf.active = false;
    }

  }

  queueAppend(buf, val) {
    if (buf.updating) {
      buf.queue.push(val);
    } else if (buf.appendBuffer) {
      buf.appendBuffer(val);
    } else {
      buf.append(new Uint8Array(val));
    }
  }


  replaceTimeToken(template, time) {
    var url = template.replace('$Time$', time);
    return url;
  }


  play() {
    this.el.play()
    this.trigger('playback:play');
    if (this.isHLS) {
      this.trigger('playback:timeupdate', 1, 1, this.name)
    }
  }

  pause() {
    this.el.pause()
  }

  stop() {
    this.pause()
    if (this.el.readyState !== 0) {
      this.el.currentTime = 0
    }
  }

  volume(value) {
    this.el.volume = value / 100
  }

  mute() {
    this.el.volume = 0
  }

  unmute() {
    this.el.volume = 1
  }

  isMuted() {
    return !!this.el.volume
  }

  isPlaying() {
    return !this.el.paused && !this.el.ended
  }

  ended() {
    this.trigger('playback:ended', this.name)
    this.trigger('playback:timeupdate', 0, this.el.duration, this.name)
  }

  stalled() {
    if (this.el.readyState < this.el.HAVE_FUTURE_DATA) {
      this.trigger('playback:buffering', this.name)
    }
  }

  waiting() {
    if(this.el.readyState < this.el.HAVE_FUTURE_DATA) {
      this.trigger('playback:buffering', this.name)
    }
  }

  bufferFull() {
    if (this.options.poster && this.firstBuffer) {
      this.firstBuffer = false
      this.el.poster = this.options.poster
    } else {
      this.el.poster = ''
    }
    this.trigger('playback:bufferfull', this.name)
  }

  destroy() {
    this.stop()
    this.el.src = ''
    this.$el.remove()
  }

  seek(seekBarValue) {
    var msrc = this.msrc
    var time = this.el.duration * (seekBarValue / 100)
    for (var i = 0; i < msrc.sourceBuffers.length; i++)
      this.resetSourceBuffer.bind(this)(msrc.sourceBuffers[i], 'seeking');
    this.seekSeconds(time)
  }

  seekSeconds(time) {
    this.el.currentTime = time
  }

  checkInitialSeek() {
    var seekTime = 0// seekStringToSeconds(window.location.href)
    this.seekSeconds(seekTime)
  }

  getCurrentTime() {
    return this.el.currentTime
  }

  getDuration() {
    return this.el.duration
  }

  timeUpdated() {
    this.trigger('playback:timeupdate', this.el.currentTime, this.el.duration, this.name)
  }

  progress() {
    if (!this.el.buffered.length) return
      var bufferedPos = 0
      for (var i = 0;  i < this.el.buffered.length; i++) {
        if (this.el.currentTime >= this.el.buffered.start(i) && this.el.currentTime <= this.el.buffered.end(i)) {
          bufferedPos = i
          break
        }
      }
      this.trigger('playback:progress', this.el.buffered.start(bufferedPos), this.el.buffered.end(bufferedPos), this.el.duration, this.name)
    }

    typeFor(src) {
      return (src.indexOf('.m3u8') > 0) ? 'application/vnd.apple.mpegurl' : 'video/mp4'
  }

  render() {
    var style = $('<style>').html(JST.CSS[this.name]);
    this.$el.append(style)
    this.trigger('playback:ready', this.name)
    process.nextTick(() => this.options.autoPlay && this.play())
    return this
  }

}


ClapprDash.canPlay = function(resource) {
  return (!!window.MediaSource && !!resource.match(/(.*).mpd/))
}


module.exports = window.ClapprDash = ClapprDash;
