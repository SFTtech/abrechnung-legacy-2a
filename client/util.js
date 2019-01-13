'use strict';

const passive_promise = () => {
    var resolve_, reject_;

    var promise = new Promise((resolve, reject) => {
        resolve_ = resolve;
        reject_ = reject;
    });

    promise.resolve = resolve_;
    promise.reject = reject_;

    return promise;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const parse_query_string = () => {
    const result = {};
    for (const entry of window.location.search.substring(1).split('&')) {
        if (entry === "") { continue; }
        const pair = entry.split('=');
        result[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
    }
    return result;
};

const get_random_string = (byte_count) => {
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    return btoa(array);
}