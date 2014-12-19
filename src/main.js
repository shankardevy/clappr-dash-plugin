var Playback = require('playback')
var JST = require('../jst')
var MPDSourceManager = require('./mpd_source_manager')
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
      'ended': 'ended',
      'stalled': 'stalled',
      'waiting': 'waiting',
      'canplaythrough': 'bufferFull',
      'loadedmetadata': 'loadedMetadata'
    }
  }

  constructor(options) {
    super(options)
    var _this = this
    this.options = options
    this.el.loop = options.loop
    this.firstBuffer = true
    this.MPDSourceManager = new MPDSourceManager(this)
    this.settings = {default: ['seekbar']}
    //this.bindEvents()
  }

  // bindEvents() {
  //   _.each(_.range(1,10), function (i) { Mousetrap.bind([i.toString()], () => this.seek(i * 10)) }.bind(this))
  // }

  setControls() {
    if (this.live) {
      this.el.preload = this.options.preload ? this.options.preload: 'none'
      this.settings.left = ["playstop"]
      this.settings.right = ["fullscreen", "volume"]
    } else {
      this.el.preload = this.options.preload ? this.options.preload: 'metadata'
      this.settings.left = ["playpause", "position", "duration"]
      this.settings.right = ["fullscreen", "volume"]
      this.settings.seekEnabled = true
    }
  }

  loadedMetadata(e) {
    this.trigger('playback:loadedmetadata', e.target.duration)
    this.trigger('playback:settingsupdate')
    this.checkInitialSeek()
  }

  getPlaybackType() {
    return this.isHLS && _.contains([0, undefined, Infinity], this.el.duration) ? 'live' : 'vod'
  }

  isHighDefinitionInUse() {
    return false
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
    if (this.getPlaybackType() === 'vod' && this.el.readyState < this.el.HAVE_FUTURE_DATA) {
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
    return 10; //this.el.duration
  }

  timeUpdated() {
    if (this.getPlaybackType() !== 'live') {
      this.trigger('playback:timeupdate', this.el.currentTime, this.el.duration, this.name)
    }
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
