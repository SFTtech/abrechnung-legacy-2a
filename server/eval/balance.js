'use strict';

if (typeof module === "undefined") {
    // this file is shared between server and client.
    // when running on the client in the browser, this code runs to
    // make the funcitons defined herein available via group.func,
    // as if you did "var balance = require('./balance')" on the server.
    var balance = {};
    var module = {exports: balance};
}

module.exports.add = (balance_object, user, amount) => {
    if (!Number.isFinite(amount)) {
        throw new Error("Illegal balance change " + amount + " for user " + JSON.stringify(user));
    }

    if (balance_object[user] === undefined) {
        balance_object[user] = 0;
    }

    balance_object[user] += amount;
}

module.exports.sum = (balance_object) => {
    var result = 0;
    for (const value of Object.values(balance_object)) {
        result += value;
    }
    return result;
}

module.exports.equalize = (balance_object, user) => {
    module.exports.add(balance_object, user, -module.exports.sum(balance_object));
}

module.exports.update = (balance_object, other_balance_object) => {
    for (const [user, value] of Object.entries(other_balance_object)) {
        module.exports.add(balance_object, user, value);
    }
}

module.exports.multiply = (balance_object, conversion_rate) => {
    for (const user of Object.keys(balance_object)) {
        balance_object[user] *= conversion_rate;
    }
}

module.exports.check_users = (balance_object, user_set) => {
    for (const user in balance_object) {
        if (!user_set.has(user)) {
            throw new Error("Unknown user " + JSON.stringify(user));
        }
    }
}
