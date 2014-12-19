var MPDParser = require('./mpd-parser')

class MPDSourceManager {
  constructor(playback) {
    var _this = this
    this.playback = playback
    this.src = playback.options.src

    // Create a Deferred object for storing the
    // parsed MPD file.
    // Since many of operations depend on successfully
    // parsed mpd, this.mpd.done will help to overcome
    // race conditions.
    this.MPDParse = new $.Deferred();

    // Get the base url of the mpd file.
    this.MPDBase = this.getMPDBase()

    // Make an ajax request to the .mpd file
    // and do more process when the ajax request
    // is successfully complete
    this.MPDRequest = $.ajax(this.src);
    this.MPDRequest.done(function (data) {
      _this.MPDParse.resolve(new MPDParser(data))
    })

    this.MPDRequest.fail(function () {
      console.log('Error downloading MPD profile')
    });

    // Set the controls for the player
    // based on the live or on-demand mpd profile
    this.MPDParse.done(function(parsedMPD) {
      playback.setControls()
      this.parsedMPD = parsedMPD
    }.bind(this))

    // Load the initial video and audio segment
    this.MPDParse.done(function(parsedMPD) {
      this.current_audio_representation = this.getAudio()
      this.current_video_representation = this.getVideo()
      this.mse = new window.MediaSource();
      this.mse.addEventListener('sourceopen', this.onSourceOpen.bind(this));
      this.playback.el.src = URL.createObjectURL(this.mse)
    }.bind(this))

  }

  availableVideos() {
    return this.parsedMPD.data['Period'][0]['adaptations']['video']['representations']
  }

  availableAudios() {
    return this.parsedMPD.data['Period'][0]['adaptations']['audio']['representations']
  }

  getVideo() {
    var representation = _.sample(this.availableVideos())
    return {
      url: this.MPDBase + representation.baseURL,
      codecs: representation.codecs,
      mimeType: representation.mimeType
    }
  }

  getAudio() {
    var representation = _.sample(this.availableAudios())
    return {
      url: this.MPDBase + representation.baseURL,
      codecs: representation.codecs,
      mimeType: representation.mimeType
    }
  }

  downloadArrayBuffer(url, context, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          var binary = new Uint8Array(xhr.response);
          callback(binary, context);
        }
      }
    }
    xhr.send();
    return xhr;
  }

  getMPDBase() {
    var result = this.src.split('/')
    result.pop()
    return result.join('/') + '/'
  }

  onSourceOpen(e) {

    // Sets up the source buffer - you parse these value out of the manifest too
    var video_buffer = this.mse.addSourceBuffer('video/mp4; codecs="avc1.4d401e"');
    this.downloadArrayBuffer(this.current_video_representation.url, video_buffer, function( data, context) {
      if (data) {
        video_buffer.appendBuffer(data);
      }
    });

    var audio_buffer = this.mse.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    this.downloadArrayBuffer(this.current_audio_representation.url, audio_buffer, function( data, context) {
      if (data) {
        audio_buffer.appendBuffer(data);
      }
    });


  }
}

module.exports = MPDSourceManager
