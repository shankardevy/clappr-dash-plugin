class MPDParser {
  constructor(xml) {
    this.$MPDDoc = $($.parseXML( xml ));
    this.data = {}
    this.parseMPDDoc()
  }

  parsedData() {
    return this.data
  }

  parseMPDDoc() {
    this.parsePeriodData()
  }

  parsePeriodData() {
    var _this = this
    _this.data['Period'] = []
    this.$MPDDoc.find('Period').each(function(i,v) {
      _this.data['Period'][i] = {
          period: $(this).attr('duration'),
          start: $(this).attr('start'),
          adaptations: _this.parseAdaptation(v)
      }
    });
  }

  parseAdaptation(xml) {
    var _this = this
    var result = {}
    var type = ''
    $(xml).find('AdaptationSet').each(function(i,v) {
      type = $(this).find('ContentComponent').attr('contentType')
      result[type] = {
        representations: _this.parseRepresentations(v)
      }
    });
    return result
  }

  parseRepresentations(xml) {
    var _this = this
    var result = []
    $(xml).find('Representation').each(function(i,v) {
      result [i] = {
        bandwidth: $(this).attr('bandwidth'),
        codecs: $(this).attr('codecs'),
        height: $(this).attr('height'),
        width: $(this).attr('width'),
        mimeType: $(this).attr('mimeType'),
        id: $(this).attr('id'),
        numChannels: $(this).attr('numChannels'),
        sampleRate: $(this).attr('sampleRate'),
        baseURL: $(this).find('BaseURL').text(),
        segmentBaseIndexRange: $(this).find('SegmentBase').attr('indexRange'),
        segmentBaseInitRange: $(this).find('Initialization').attr('range'),

      }
    });
    return result
  }

}

module.exports = MPDParser;
