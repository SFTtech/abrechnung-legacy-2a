'use strict';

const read_file_sync = require('fs').readFileSync;

module.exports = JSON.parse(read_file_sync(__dirname + "/config.json"));
