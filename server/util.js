"use strict";

const promisify = require("util").promisify;
const fs = require("fs");
const crypto = require("crypto");
const CV = require("await-notify").Subject;

/**
 * turns a result/error callback-accepting function into a
 * promise-returning function.
 */
module.exports.promisify = promisify;

/**
 * passive_promise is a promise that can be manually resolved.
 *
 * usage:
 *
 * const pp = passive_promise();
 *
 * (in place a) await pp;
 * (in place b) pp.resolve({test: 5});
 */
module.exports.passive_promise = () => {
    var resolve_, reject_;

    var promise = new Promise((resolve, reject) => {
        resolve_ = resolve;
        reject_ = reject;
    });

    promise.resolve = resolve_;
    promise.reject = reject_;

    return promise;
};

/**
 * a promisified version of readFile
 */
module.exports.read_file = promisify(fs.readFile);

/**
 * an async sleep(ms) function
 */
module.exports.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * tests whether the given string is definitely safe against SQL injection exploits
 */
module.exports.is_string_safe = (string) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(string);

/**
 * generates a random string with the given number of bytes
 */
module.exports.random_string = (byte_count) => {
    return crypto.randomBytes(32).toString("base64");
};

module.exports.WatchableValue = class {
    constructor(default_value) {
        this.value = default_value;
        this.cv = new CV();
    }

    set(value) {
        this.value = value;
        this.cv.notifyAll();
    }

    get() {
        return this.value;
    }

    async wait_condition(condition) {
        /*eslint no-constant-condition: ["error", { "checkLoops": false }]*/
        while (true) {
            const value = this.get();
            if (condition(value)) { return value; }
            await this.cv.wait();
        }
    }
};

module.exports.MonotonicNumber = class {
    constructor() {
        this.value = 0;
    }

    get() {
        return this.value;
    }

    bump(value) {
        if (this.value < value) {
            this.value = value;
        }
    }
};
