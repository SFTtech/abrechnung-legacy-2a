'use strict';

if (typeof module === "undefined") {
    // this file is shared between server and client.
    // when running on the client in the browser, this code runs to
    // make the funcitons defined herein available via typecheck.func,
    // as if you did "var typecheck = require('./typecheck')" on the server.
    var typecheck = {};
    var module = {exports: typecheck};
}

// various type checkers
module.exports.array = Array.isArray;
module.exports.object = (object) => ((typeof object === "object") && !Array.isArray(object));
module.exports.bool = (object) => (object === true) || (object === false);
module.exports.number = Number.isFinite;
module.exports.number_nonnegative = (object) => (Number.isFinite(object) && (object >= 0));
module.exports.string = (object) => ((typeof object) === "string");
module.exports.string_nz = (object) => (((typeof object) === "string") && (object !== ""));
module.exports.string_re = (re) => (object) => (((typeof object) === "string") && object.match(re));
module.exports.string_email = module.exports.string_re(/^[a-zA-Z0-9.+,-]+@[a-zA-Z0-9.-]+$/);
module.exports.choice = (set) => (object) => set.has(object);
module.exports.optional = (inner_type) => (object) => ((object === undefined) || inner_type(object));

module.exports.validate_object_structure = (object, types) => {
    // check that all required properties exist and have the correct type
    for (const [key, type] of Object.entries(types)) {
        if (!type(object[key])) {
            if (object[key] === undefined) {
                throw new Error("missing object entry " + JSON.stringify(key));
            }
            throw new Error("bad object entry " + JSON.stringify(key) + ": " + JSON.stringify(object[key]));
        }
    }

    // checks that the object has no superfluous properties
    for (const key of Object.keys(object)) {
        if (types[key] === undefined) {
            throw new Error("superfluous object entry " + JSON.stringify(key) + ": " + JSON.stringify(object[key]));
        }
    }
}

module.exports.empty_object = (object) => {
    // wtf @es6
    // is this truly the best solution?
    for (const key in object) {
        return false;
    }
    return true;
};

module.exports.validate_uid = (uid) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(uid)) {
        throw Error("bad user id");
    };
}

module.exports.validate_username = (name) => {
    if (!module.exports.string_nz(name)) {
        throw Error("bad user name");
    };
}

module.exports.validate_email = (email) => {
    if (!module.exports.string_email(email)) {
        throw Error("bad email");
    }
}