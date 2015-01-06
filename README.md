# Clappr MPEG Dash Player Plugin

Demo
---

Visit http://dash-player.opendrops.com/

What is done?
-------------
* The plugin plays static live mpd profile in this format. http://178.62.104.182:1935/vod/mp4:sample.mp4/manifest.mpd

* MPD Live profiles can be used for playing VOD as per the DASH specification.


How to preview
-------------

* clone this repo

* `npm install`

* Open index.html and change the mpd source url pointing to your server

* `gulp serve`

* Going to http://localhost:3000 should now play the video from parsing the MPD file.
