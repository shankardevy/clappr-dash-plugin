var Playback = require('playback')
var JST = require('../jst')
var DashParser = require('./dash.js/DashParser')
var SourceManager = require('./source-manager')
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
    var self = this
    this.options = options
    this.el.loop = options.loop
    this.settings = {default: ['seekbar']}
    this.settings.left = ["playpause", "position", "duration"]
    this.settings.right = ["fullscreen", "volume"]
    this.settings.seekEnabled = true
    this.downloadedTimeframes = []
    this.baseURL = this.parseBaseUrl(options.src)

    // Dash
    var mpdDownloader = $.ajax({
      url: options.src,
      beforeSend: function( xhr ) {
        xhr.overrideMimeType( "text/plain; charset=UTF-8" )
      }
    })

    mpdDownloader.done(function(data) {
      var mpd
      var parser = new DashParser()
      mpd = parser.parse(data, self.baseURL);
      this.source_manager = new SourceManager(self.el, mpd)
    })

    mpdDownloader.fail(function() {
      alert( "error downloading mpd file" );
    })

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


  play() {
    this.el.play()
    this.trigger('playback:play');
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
    if (this.el.readyState < this.el.HAVE_ENOUGH_DATA) {
      this.trigger('playback:buffering', this.name)
    }
  }

  waiting() {
    if(this.el.readyState < this.el.HAVE_ENOUGH_DATA) {
      this.trigger('playback:buffering', this.name)
    }
  }

  bufferFull() {
    console.log('canplaythrough')
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
