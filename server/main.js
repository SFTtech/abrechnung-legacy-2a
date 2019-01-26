'use strict';

const util = require("./util.js");
const cache = require("./cache.js");
const websocket_server = require("./websocket_server.js");
const typecheck = require("./eval/typecheck.js");
const evaluate_group = require('./eval/group.js').evaluate;


const state = {
    connection_counter: 0,
    listeners: {},
};

const on_open = connection => {
    connection.connection_index = state.connection_counter++;

    // uid of logged-in user.
    // if nobody is currently logged-in, it is null.
    // if a login is currently going on, it is undefined.
    connection.user = new util.WatchableValue(null);

    // waits until the user has logged in, then returns the uid string.
    connection.get_user = async () => {
        return await connection.user.wait_condition((value) => (
            (value !== null) && (value !== undefined)
        ));
    };

    console.log(`[${connection.connection_index}] opened from ${connection.remoteAddress}`);
};

const crpc_functions = {};

const on_close = (connection, description) => {
    console.log(`[${connection.connection_index}] closed (${description})`);

    delete state.listeners[connection.connectionIdx];
};

/**
 * simple function for testing CRPC communication.
 * returns the arguments as the result.
 */
crpc_functions.echo = async (connection, args) => {
    return args;
};

/**
 * simple function for testing SRPC communication.
 * calls the given SRPC and returns its result as the result.
 */
crpc_functions.trigger_srpc = async (connection, args) => {
    const srpc_result = await connection.srpc(args.srpc_func, args.srpc_args);
    return { "srpc_return_value": srpc_result };
};

/**
 * offers the server's group evaulation capabilities,
 * as a service.
 *
 * the evaulation results are returned in the result.
 */
crpc_functions.evaluate_group_as_a_service = async (connection, args) => {
    return { "result": evaluate_group(args.group, args.users) };
};

const ARGS_LOGIN_PASSWORD = {};
ARGS_LOGIN_PASSWORD.uid = typecheck.string_nz;
ARGS_LOGIN_PASSWORD.password = typecheck.string;
ARGS_LOGIN_PASSWORD.remember_device = typecheck.optional(typecheck.string_nz);

/**
 * authenticates the user with credentials.
 */
crpc_functions.login_password = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_LOGIN_PASSWORD);

    if (connection.user.get() === undefined) { throw Error("login is already running"); }
    if (connection.user.get() !== null) { throw Error("already logged in"); }
    connection.user.set(undefined);

    try {
        await connection.db.check_user_password(args.uid, args.password);

        connection.user.set(args.uid);

        if (args.remember_device !== undefined) {
            // create a token and report it back
            const token = util.random_string(32);
            await connection.db.add_auth_token(args.uid, args.remember_device, token);
            connection.device_id = args.remember_device;
            return { "auth_token": token };
        } else {
            // don't create a token
            connection.device_id = null;
            return {};
        }
    } catch (exception) {
        connection.user.set(null);
        throw exception;
    }
};

const ARGS_LOGIN_AUTH_TOKEN = {};
ARGS_LOGIN_AUTH_TOKEN.uid = typecheck.string_nz;
ARGS_LOGIN_AUTH_TOKEN.device_id = typecheck.string_nz;
ARGS_LOGIN_AUTH_TOKEN.auth_token = typecheck.string_nz;

crpc_functions.login_auth_token = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_LOGIN_AUTH_TOKEN);

    if (connection.user.get() === undefined) { throw Error("login is already running"); }
    if (connection.user.get() !== null) { throw Error("already logged in"); }
    connection.user.set(undefined);

    try {
        await connection.db.check_auth_token(args.uid, args.device_id, args.auth_token);
    } finally {
        connection.user.set(null);
    }

    connection.user.set(args.uid);
    connection.device_id = args.device_id;
};

const ARGS_FORGET_AUTH_TOKEN = {};
ARGS_FORGET_AUTH_TOKEN.uid = typecheck.string_nz;
ARGS_FORGET_AUTH_TOKEN.device_id = typecheck.string_nz;

crpc_functions.forget_auth_token = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_FORGET_AUTH_TOKEN);
    await connection.db.delete_auth_token(args.uid, args.device_id);
};

const ARGS_VALIDATE_SET_PASSWORD_TOKEN = {};
ARGS_VALIDATE_SET_PASSWORD_TOKEN.uid = typecheck.string_nz;
ARGS_VALIDATE_SET_PASSWORD_TOKEN.set_password_token = typecheck.string_nz;

crpc_functions.validate_set_password_token = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_VALIDATE_SET_PASSWORD_TOKEN);

    return await connection.db.validate_set_password_token(args.uid, args.set_password_token);
};

const ARGS_SET_PASSWORD = {};
ARGS_SET_PASSWORD.uid = typecheck.string_nz;
ARGS_SET_PASSWORD.set_password_token = typecheck.string_nz;
ARGS_SET_PASSWORD.password = typecheck.string_nz;

crpc_functions.set_password = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_SET_PASSWORD);

    await connection.db.pop_set_password_token(args.uid, args.set_password_token);

    return await connection.db.set_password(args.uid, args.password);
}

const ARGS_LISTEN_USERS = {};

crpc_functions.listen_users = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_LISTEN_USERS);

    const self_uid = await connection.get_user();

    const added_users_last_mod_seq = new util.MonotonicNumber();
    const my_account_last_mod_seq = new util.MonotonicNumber();

    connection.users_update_callback = async () => {
        const added_users_updates = (await connection.db.query(
            `
            with userentries as (
                select * from users
                where
                    added_by = $1 and last_mod_seq > $2
            ), max_last_mod_seq as (
                select max(last_mod_seq) as max_last_mod_seq from userentries
            )
            select 
                id,
                name,
                added,
                email,
                max_last_mod_seq,
                (password_set is not null) as activated
            from
                userentries, max_last_mod_seq
            order by
                last_mod_seq
            ;
            `,
            [self_uid, added_users_last_mod_seq.get()]
        )).rows;

        if (added_users_updates.length > 0) {
            added_users_last_mod_seq.bump(added_users_updates[0].max_last_mod_seq);
        }

        const my_account_update = (await connection.db.query(
            `
            select
                id,
                name,
                email,
                added,
                added_by,
                password_set,
                email_update_request,
                email_update_request_timestamp,
                last_mod_seq
            from
                users
            where
                id = $1 and last_mod_seq > $2
            order by
                last_mod_seq
            ;
            `,
            [self_uid, my_account_last_mod_seq.get()]
        )).rows[0];

        if (my_account_update) {
            my_account_last_mod_seq.bump(my_account_update.last_mod_seq);
        }

        await connection.supd("users_update", {
            added_users: added_users_updates,
            my_account: my_account_update
        });
    };

    await connection.db.listen("users", connection.users_update_callback);
    await connection.users_update_callback();
};

const ARGS_ADD_NEW_USER = {};
ARGS_ADD_NEW_USER.uid = typecheck.string_nz;
ARGS_ADD_NEW_USER.name = typecheck.string_nz;
ARGS_ADD_NEW_USER.email = typecheck.optional(typecheck.string_nz);

crpc_functions.add_new_user = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_ADD_NEW_USER);

    const self_uid = await connection.get_user();

    await connection.db.add_user(args.uid, args.name, args.email, self_uid);
};

const ARGS_UPDATE_MY_ACCOUNT_NAME = {};
ARGS_UPDATE_MY_ACCOUNT_NAME.name = typecheck.string_nz;

crpc_functions.update_my_account_name = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_UPDATE_MY_ACCOUNT_NAME);

    const self_uid = await connection.get_user();

    await connection.db.update_user_name(self_uid, args.name);
};

const ARGS_UPDATE_MY_ACCOUNT_EMAIL = {};
ARGS_UPDATE_MY_ACCOUNT_EMAIL.email = typecheck.string_email;

crpc_functions.update_my_account_email = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_UPDATE_MY_ACCOUNT_EMAIL);

    const self_uid = await connection.get_user();

    await connection.db.request_update_user_email(self_uid, args.email);
};

const ARGS_VALIDATE_UPDATE_EMAIL_TOKEN = {};
ARGS_VALIDATE_UPDATE_EMAIL_TOKEN.uid = typecheck.string_nz;
ARGS_VALIDATE_UPDATE_EMAIL_TOKEN.update_email_token = typecheck.string_nz;

crpc_functions.validate_update_email_token = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_VALIDATE_UPDATE_EMAIL_TOKEN);

    return await connection.db.check_update_email_token(args.uid, args.update_email_token);
};

const ARGS_CONFIRM_UPDATE_EMAIL = {};
ARGS_CONFIRM_UPDATE_EMAIL.uid = typecheck.string_nz;
ARGS_CONFIRM_UPDATE_EMAIL.update_email_token = typecheck.string_nz;

crpc_functions.confirm_update_email = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_CONFIRM_UPDATE_EMAIL);

    return await connection.db.confirm_update_email(args.uid, args.update_email_token);
};

const ARGS_ABORT_UPDATE_EMAIL = {};

crpc_functions.abort_update_email = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_ABORT_UPDATE_EMAIL);

    const self_uid = await connection.get_user();

    return await connection.db.abort_update_email(self_uid);
};

const ARGS_LISTEN_GROUPS = {};

crpc_functions.listen_groups = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_LISTEN_GROUPS);

    const self_uid = await connection.get_user();

    const groups_last_mod_seq = new util.MonotonicNumber();
    const group_memberships_last_mod_seq = new util.MonotonicNumber();

    connection.groups_update_callback = async () => {
        const groups_updates = (await connection.db.query(
            `
            select
                group.id as id,
                group.name as name,
                group.created as created,
                group.created_by as created_by,
                group.last_mod_seq as last_mod_seq
            from
                groups,
                group_memberships
            where
                groups.id = group_memberships.gid and
                group_memberships.uid = $1 and
                (
                    group.last_mod_seq > $2 or
                    group_membership.last_mod_seq > $3
                )
            order by
                group.last_mod_seq
            ;
            `,
            [self_uid, groups_last_mod_seq.get(), group_memberships_last_mod_seq.get()]
        )).rows;

        if (added_users_updates.length > 0) {
            last_mod_seq.bump(added_users_updates[added_users_updates.length - 1].last_mod_seq);
        }

        await connection.db.query(
            `
            select
                group_membership.gid as gid,
                group_membership.uid as uid
            from
                group_membership,
                group_membership as group_membership2
            where
                group_membership.gid = group_membership2.gid and
                group_membership2.uid = $1
            `
        );

        await connection.supd("users_update", {
            added_users: added_users_updates,
            my_account: my_account_update
        });
    };

    await connection.db.listen("groups", connection.groups_update_callback);
    connection.groups_update_callback();
};


/*
rpc_functions.listen_group_invites = async (connection, request) => {
    await require_login(connection);
    var updateDump = db.dumpUpdates(request.from);
    for (let update of updateDump) {
        update.type = "update";
        update.contenthash = util.sha256(update.json + update.comment);
        // TODO (data protection): decide whether this update concerns the user.
        if (!true) {
            delete update.json;
            delete update.comment;
        }
        connection.sendUTF(JSON.stringify(update));
    }
    state.listeners[connection.connectionIdx] = connection;
    return {pending: updateDump.length};
};
*/

/*
rpc_functions.add_update = async (connection, request) => {
    // the user needs to be logged in to submit an update
    var author = await requireLogin(connection);
    // create the update, validate it, and apply it to the event cache
    var update = updates.createAndApply(author, request.mode, request.json, request.comment, request.event, cache.events, cache.latestUpdateHash);
    // write the update to the database
    db.addUpdate(update);
    cache.latestUpdateHash = updates.hash(update);
    // send the update to all connected listeners
    update.type = "update";
    var updateJSON = JSON.stringify(update);
    delete update.json;
    delete update.comment;
    var updateJSONCensored = JSON.stringify(update);
    for (let connectionIdx of Object.keys(state.listeners)) {
        // TODO (data protection): decide whether this update concerns the user.
        if (true) {
            state.listeners[connectionIdx].sendUTF(updateJSON);
        } else {
            state.listeners[connectionIdx].sendUTF(updateJSONCensored);
        }
    }
    return { idx: update.idx, event: update.event };
}
*/

const main = async() => {
    await websocket_server(on_open, crpc_functions, on_close);
}

main().then(result => console.log("server is running"));
