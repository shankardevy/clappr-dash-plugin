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
    window.testing = repSrc;
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
      this.fetchNextSegment(buf, this, msrc);
    }

    if (!active && msrc.readyState == 'open') {
      msrc.endOfStream();
      return;
    }
  }

  fetchNextSegment(buf, video, msrc) {
    if (buf.xhr) return;
    var rep = buf.rep;
    var url;

    if (!buf.init_loaded) {
      url =  rep.BaseURL + rep.init;
      this.makeXHR(buf, url, true);
      return;
    }
    url = rep.BaseURL + this.replaceTimeToken(rep.segmentURLTemplate, buf);
    this.makeXHR(buf, url);
  }

  makeXHR(buf, url, is_init) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = 'arraybuffer';
    xhr.addEventListener('load', this.onXHRLoad.bind(this));
    xhr.buf = buf;
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

    if (xhr.is_init) {
      buf.init_loaded = true;
    } else {
      window.bufTest = buf;
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


  replaceTimeToken(template, buf) {
    var url = template.replace('$Time$', buf.nextSegDuration);
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
    var time = this.el.duration * (seekBarValue / 100)
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
