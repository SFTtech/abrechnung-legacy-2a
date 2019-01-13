'use strict';

if (typeof module === "undefined") {
    // this file is shared between server and client.
    // when running on the client in the browser, this code runs to
    // make the funcitons defined herein available via group.func,
    // as if you did "var group = require('./group')" on the server.
    var group = {};
    var module = {exports: group};
}

const typecheck = require('./typecheck.js');
const balance = require('./balance.js');

var dialects = {}
dialects["sft-kybernetik-0"] = require("./group_sft_kybernetik_0.js");

module.exports.evaluate = (group, users) => {
    const dialect = dialects[group.dialect];
    if (dialect === undefined) {
        throw new Error("unknown dialect " + JSON.stringify(group.dialect));
    }

    return dialect.evaluate(group, users);
};
