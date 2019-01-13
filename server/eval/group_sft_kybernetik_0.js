'use strict';

if (typeof module === "undefined") {
    // this file is shared between server and client.
    // when running on the client in the browser, this code runs to
    // make the funcitons defined herein available via group.func,
    // as if you did "var group = require('./group')" on the server.
    var group_sft_kybernetik_0 = {};
    var module = {exports: group_sft_kybernetik_0};
}

const typecheck = require('./typecheck.js');
const balance = require('./balance.js');

var GROUP_TEMPLATE = {};
GROUP_TEMPLATE.dialect = typecheck.choice(new Set(["sft-kybernetik-0"]));
GROUP_TEMPLATE.description = typecheck.string;
GROUP_TEMPLATE.pseudousers = typecheck.optional(typecheck.object);
GROUP_TEMPLATE.currencies = typecheck.optional(typecheck.object);
GROUP_TEMPLATE.events = typecheck.object;

var PSEUDOUSER_TEMPLATE = {};
PSEUDOUSER_TEMPLATE.description = typecheck.string;
PSEUDOUSER_TEMPLATE.shares = typecheck.object;

var PURCHASE_TEMPLATE = {};
PURCHASE_TEMPLATE.type = typecheck.choice(new Set(["purchase"]));
PURCHASE_TEMPLATE.description = typecheck.string;
PURCHASE_TEMPLATE.shares = typecheck.object;
PURCHASE_TEMPLATE.items = typecheck.array;
PURCHASE_TEMPLATE.paid_by = typecheck.string_nz;
PURCHASE_TEMPLATE.assists = typecheck.optional(typecheck.object);
PURCHASE_TEMPLATE.currency = typecheck.optional(typecheck.string_nz);

var PURCHASE_ITEM_TEMPLATE = {};
PURCHASE_ITEM_TEMPLATE.name = typecheck.string_nz;
PURCHASE_ITEM_TEMPLATE.count = typecheck.optional(typecheck.number_nonnegative);
PURCHASE_ITEM_TEMPLATE.cost = typecheck.optional(typecheck.number);
PURCHASE_ITEM_TEMPLATE.total_cost = typecheck.optional(typecheck.number);
PURCHASE_ITEM_TEMPLATE.unit = typecheck.optional(typecheck.string_nz);
PURCHASE_ITEM_TEMPLATE.usages = typecheck.optional(typecheck.object);
PURCHASE_ITEM_TEMPLATE.shares = typecheck.optional(typecheck.object);

var PAYMENT_TEMPLATE = {};
PAYMENT_TEMPLATE.type = typecheck.choice(new Set(["payment"]));
PAYMENT_TEMPLATE.description = typecheck.string;
PAYMENT_TEMPLATE.paid_to = typecheck.string_nz;
PAYMENT_TEMPLATE.amount = typecheck.number_nonnegative;
PAYMENT_TEMPLATE.paid_by = typecheck.string_nz;
PAYMENT_TEMPLATE.assists = typecheck.optional(typecheck.object);
PAYMENT_TEMPLATE.currency = typecheck.optional(typecheck.string_nz);

const evaluate_pseudousers = (pseudousers_object, user_set) => {
    // {pseudouser_name: {user name: share}}
    // for each pseudouser name: sum(share) == 1.0
    var pseudouser_normalized_shares = {};

    for (const [pseudouser_name, pseudouser_object] of Object.entries(pseudousers_object || {})) {
        // validate the pseudouser name
        if (!pseudouser_name.startsWith(':')) {
            throw new Error("bad pseudouser name '" + pseudouser_name + "'");
        }

        // validate the pseudouser raw shares and calculate the total sum
        typecheck.validate_object_structure(pseudouser_object, PSEUDOUSER_TEMPLATE);

        var total_shares = 0;
        for (const [username, raw_share_amount] of Object.entries(pseudouser_object.shares)) {
            if (!typecheck.number(raw_share_amount)) {
                throw new Error("bad pseudouser share amount " + JSON.stringify(raw_share_amount));
            }
            if ((!username.startsWith(':')) && (!user_set.has(username))) {
                throw new Error("unknown user name " + JSON.stringify(username));
            }
            total_shares += raw_share_amount;
        }

        // fill pseudouser_normalized_shares
        pseudouser_normalized_shares[pseudouser_name] = {}

        for (const [username, raw_share_amount] of Object.entries(pseudouser_object.shares)) {
            const share_amount = raw_share_amount / total_shares;
            pseudouser_normalized_shares[pseudouser_name][username] = share_amount;
        }
    }

    // pseudousers may depend on each other.
    // resolve these dependencies.
    var pseudouser_resolved_shares = {}
    for (const [pseudouser_name, pseudouser_shares] of Object.entries(pseudouser_normalized_shares)) {
        resolve_pseudouser_shares(
            pseudouser_name,
            pseudouser_normalized_shares,
            pseudouser_resolved_shares,
            new Set() /* stack */
        );
    }

    return pseudouser_resolved_shares;
};

const resolve_pseudouser_shares = (pseudouser_name, normalized, resolved, stack) => {
    if (normalized[pseudouser_name] === undefined) {
        throw new Error("unknown pseudouser reference: " + JSON.stringify(pseudouser_name));
    }

    // check if this pseudouser has already been resolved
    if (resolved[pseudouser_name] !== undefined) { return; }

    const dbg_prefix = "    ".repeat(stack.size);

    if (stack.has(pseudouser_name)) {
        throw new Error("circular dependency between pseudousers: " + JSON.stringify(Array.from(stack)));
    }

    var resolution = {}

    stack.add(pseudouser_name);

    for (const [depend, amount] of Object.entries(normalized[pseudouser_name])) {
        if (depend.startsWith(':')) {
            // resolve the dependency pseudouser's shares first
            resolve_pseudouser_shares(depend, normalized, resolved, stack);
            for (const [user, depend_amount] of Object.entries(resolved[depend])) {
                resolution[user] = (resolution[user] || 0) + amount;
            }
        } else {
            resolution[depend] = (resolution[depend] || 0) + amount;
        }
    }

    stack.delete(pseudouser_name);
    resolved[pseudouser_name] = resolution;
};

const normalize_shares_object = (obj) => {
    var total_shares = 0;

    for (const [user, value] of Object.entries(obj)) {
        if (!typecheck.string_nz(user)) {
            throw new Error("illegal user " + JSON.stringify(user));
        }
        if (!typecheck.number_nonnegative(value)) {
            throw new Error("illegal share amount for " + JSON.stringify(user) + ": " + JSON.stringify(value));
        }
        total_shares += value;
    }

    if (total_shares <= 0) {
        throw new Error("shares are zero; cannot split");
    }

    var result = {}

    for (const [user, value] of Object.entries(obj)) {
        result[user] = value / total_shares;
    }

    return result;
}

const evaluate_assists = (obj) => {
    var result = {};

    if (obj === undefined) { return result; }

    for (const [user, value] of Object.entries(obj)) {
        balance.add(result, user, value);
    }

    return result;
}

const evaluate_purchase_item = (item, shares, balance_sub) => {
    // validate the item
    typecheck.validate_object_structure(item, PURCHASE_ITEM_TEMPLATE);

    // count defaults to 1 if not given
    var count = item.count;
    if (count === undefined) { count = 1; }

    // cost is given either directly, or as total_cost
    var cost = item.cost;
    if (cost === undefined) {
        if (item.total_cost === undefined) {
            throw new Error("item " + JSON.stringify(item.name) + " has no cost");
        } else {
            cost = item.total_cost / count;
        }
    }

    // by default, the item uses the purchase's shares.
    var item_shares = shares;
    if (item.shares !== undefined) {
        item_shares = normalize_shares_object(item.shares);
    }

    // number of items which have not been assigned to a user
    var used_count = 0;

    // iterate over all the defined usages
    for (const [user, amount] of Object.entries(item.usages || {})) {
        if (!typecheck.number_nonnegative(amount)) {
            throw new Error(JSON.stringify(item.name) + ": Usage amount for " + JSON.stringify(user) + " must be >= 0, but is " + JSON.stringify(amount));
        }

        balance_sub(user, -cost * amount);
        used_count += amount;
    }

    if (used_count > count) {
        throw new Error(JSON.stringify(item.name) + ": Used " + JSON.stringify(used_count) + ", but total count is only " + JSON.stringify(count));
    }

    if (used_count < count) {
        // split the remaining items according to item_shares.
        const remaining_cost = cost * (count - used_count);

        for (const [user, normalized_share] of Object.entries(item_shares)) {
            balance_sub(user, -remaining_cost * normalized_share);
        }
    }
}

const evaluate_purchase = (obj, extra_info) => {
    typecheck.validate_object_structure(obj, PURCHASE_TEMPLATE);
    var shares = normalize_shares_object(obj.shares);

    var balances = {}

    const balance_sub = (user, amount) => balance.add(balances, user, -amount);

    // evaluate all items of the purchase
    for (const item of obj.items) {
        try {
            evaluate_purchase_item(item, shares, balance_sub);
        } catch (exception) {
            console.log(exception);
            throw new Error("item " + JSON.stringify(item.name) + ": " + exception.message);
        }
    }

    // evaluate assists
    balance.update(balances, evaluate_assists(obj.assists));

    // finally, equalize the balance by crediting the user who paid
    balance.equalize(balances, obj.paid_by);

    return balances;
};

const evaluate_payment = (obj) => {
    typecheck.validate_object_structure(obj, PAYMENT_TEMPLATE);
    var balances = {};

    // evaluate balances
    balance.add(balances, obj.paid_to, -obj.amount);

    // evaluate assists
    balance.update(balances, evaluate_assists(obj.assists));

    // finally, equalize the balance by crediting the user who paid
    balance.equalize(balances, obj.paid_by);

    return balances;
};

const evaluate_event = (event_object) => {
    if (!typecheck.object(event_object)) {
        throw new Error("expected event object, but got " + JSON.stringify(event_object));
    }
    if (event_object.type === undefined) {
        throw new Error("event object doesn't specify a type: " + JSON.stringify(event_object));
    }

    if (event_object.type === "purchase") {
        return evaluate_purchase(event_object);
    }
    if (event_object.type === "payment") {
        return evaluate_payment(event_object);
    }
    throw new Error("unknown event type " + JSON.stringify(event_object.type));
};

const evaluate_currencies = (obj) => {
    var result = {};

    if (obj === undefined) { return result; }

    for (const [currency, conversion_rate] of Object.entries(obj)) {
        if (!typecheck.number_nonnegative(conversion_rate)) {
            throw new Error("currency " + JSON.stringify(currency) + ": bad conversion rate " + JSON.stringify(conversion_rate));
        }
        result[currency] = conversion_rate;
    }

    return result;
}

module.exports.evaluate = (group, users) => {
    // parses the given group object, using the given user list.
    // - if the group object is valid and consistent, returns the balance mapping.
    // - if the group object is invalid, gives an exception.

    typecheck.validate_object_structure(group, GROUP_TEMPLATE);

    var user_set = new Set(users);

    const pseudouser_shares = evaluate_pseudousers(group.pseudousers || {}, user_set);
    for (const pseudouser in pseudouser_shares)
    {
        // enter the pseudouser into the users set
        user_set.add(pseudouser);
    }

    const currencies = evaluate_currencies(group.currencies);

    // the final result of the evaluation
    var balances = {}

    // process the events
    for (const [event_name, event_object] of Object.entries(group.events))
    {
        try {
            const event_balances = evaluate_event(event_object);
            balance.check_users(event_balances, user_set);
            if (event_object.currency !== undefined) {
                const conversion_rate = currencies[event_object.currency]

                if (conversion_rate === undefined) {
                    throw new Error("unknown currency " + JSON.stringify(event_object.currency));
                }
                balance.multiply(event_balances, conversion_rate);
            }
            balance.update(balances, event_balances);
        } catch (exception) {
            throw new Error(event_object.type + " " + JSON.stringify(event_name) + ": " + exception.message);
        }
    }

    // split the various pseudousers to the actual users
    for (const [pseudouser, shares] of Object.entries(pseudouser_shares))
    {
        const pseudouser_balance = balances[pseudouser];
        delete balances[pseudouser];

        if (pseudouser_balance === undefined) { continue; }

        // split the pseudouser between actual users.
        for (const [user, share] of Object.entries(shares))
        {
            balance.add(balances, user, pseudouser_balance * share);
        }
    }

    return balances;
};
