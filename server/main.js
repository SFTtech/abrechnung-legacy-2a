"use strict";

const util = require("./util.js");
const websocket_server = require("./websocket_server.js");
const typecheck = require("./eval/typecheck.js");
const evaluate_group = require("./eval/group.js").evaluate;


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
};

const ARGS_LISTEN_USERS = {};

/**
 * It is no problem if a client calls this several times. If a client calls
 * it, an already installed calback ist replaced by a new one and the
 * counters are reset to 0 and so a complete update is sent.
 * The old callback will be freed by as soon it completes.
 * A client can use this behaviour to resync.
 */
crpc_functions.listen_users = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_LISTEN_USERS);

    const self_uid = await connection.get_user();

    const added_users_last_mod_seq = new util.MonotonicNumber();
    const my_account_last_mod_seq = new util.MonotonicNumber();
    const users_last_mod_seq = new util.MonotonicNumber();

    const users_update_callback = async () => {
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

        const users_update = (await connection.db.query(
            `
            with users_of_groups_of_user as (
                select users.*
                from
                    users,
                    group_memberships as gm1,
                    group_memberships as gm2
                where
                    users.id = gm1.uid and
                    gm1.gid = gm2.gid and
                    gm2.uid = $1 and
                    users.last_mod_seq > $2
            ), max_last_mod_seq as (
                select max(last_mod_seq) as max_last_mod_seq from users_of_groups_of_user
            )
            select distinct
                id,
                name,
                added,
                added_by,
                max_last_mod_seq
            from
                users_of_groups_of_user, max_last_mod_seq
            order by
                id
            ;
            `,
            [self_uid, users_last_mod_seq.get()]
        )).rows;

        if (users_update.length > 0) {
            users_last_mod_seq.bump(users_update[0].last_mod_seq);
        }

        if (added_users_updates.length > 0 || my_account_update || users_update.length > 0) {
            await connection.supd("users_update", {
                "added_users": added_users_updates,
                "my_account": my_account_update,
                "users": users_update
            });
        }
    };

    await connection.db.listen("users", users_update_callback);
    await users_update_callback();
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

    const last_mod_seq = new util.MonotonicNumber();

    const groups_update_callback = async () => {
        const groups_updates = (await connection.db.query(
            `
            with groups_of_user as (
                select groups.*
                from
                    groups,
                    group_memberships
                where
                    groups.id = group_memberships.gid and
                    group_memberships.uid = $1 and
                    groups.last_mod_seq > $2
            ), max_last_mod_seq as (
                select max(last_mod_seq) as max_last_mod_seq from groups_of_user
            )
            select
                id,
                name,
                created,
                created_by,
                max_last_mod_seq
            from
                groups_of_user, max_last_mod_seq
            order by
                last_mod_seq
            ;
            `,
            [self_uid, last_mod_seq.get()]
        )).rows;

        if (groups_updates.length > 0) {
            last_mod_seq.bump(groups_updates[0].max_last_mod_seq);
            await connection.supd("groups_update", {
                groups: groups_updates,
            });
        }
    };

    await connection.db.listen("groups", groups_update_callback);
    await groups_update_callback();
};

const ARGS_LISTEN_GROUP_MEMBERSHIPS = {};

crpc_functions.listen_group_memberships = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_LISTEN_GROUP_MEMBERSHIPS);

    const self_uid = await connection.get_user();

    const last_mod_seq = new util.MonotonicNumber();

    const group_memberships_update_callback = async () => {
        const group_memberships_updates = (await connection.db.query(
            `
            with memberships as (
                select * from group_memberships
                where
                    uid = $1 and 
                    last_mod_seq > $2
            ), max_last_mod_seq as (
                select max(last_mod_seq) as max_last_mod_seq from memberships
            )
            select
                gid,
                uid,
                added,
                added_by,
                role,
                max_last_mod_seq
            from memberships, max_last_mod_seq
            order by
                last_mod_seq
            ;
            `,
            [self_uid, last_mod_seq.get()]
        )).rows;

        if (group_memberships_updates.length > 0) {
            last_mod_seq.bump(group_memberships_updates[0].max_last_mod_seq);
            await connection.supd("group_memberships_update", {
                group_memberships: group_memberships_updates,
            });
        }
    };

    await connection.db.listen("group_memberships", group_memberships_update_callback);
    await group_memberships_update_callback();
};

const ARGS_GET_GROUPS_BY_ID = {};
ARGS_GET_GROUPS_BY_ID.ids = typecheck.array_of_type(typecheck.multicheck([typecheck.integer, typecheck.positive]));
ARGS_GET_GROUPS_BY_ID.last_mod_seq = typecheck.multicheck([typecheck.integer, typecheck.nonnegative]);

crpc_functions.get_groups_by_id = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_GET_GROUPS_BY_ID);

    const self_uid = await connection.get_user();

    // make array dense: remove any elem which is unset
    const ids = args.ids.filter( () => true );

    if (ids.length === 0) {
        return { "groups": [] };
    }

    let paramnr = 2;
    const callparams = ids.map( () => "$"+(paramnr++) ).join(",");

    const groups = (await connection.db.query(
        `
        with groups_of_user as (
            select groups.*
            from
                groups,
                group_memberships
            where
                groups.id = group_memberships.gid and
                group_memberships.uid = $1 and
                groups.id in (${callparams})
        ), max_last_mod_seq as (
            select max(last_mod_seq) as max_last_mod_seq from groups_of_user
        )
        select
            id,
            name,
            created,
            created_by,
            max_last_mod_seq
        from
            groups_of_user, max_last_mod_seq
        order by
            last_mod_seq
        ;
        `,
        [self_uid].concat(ids)
    )).rows;

    return { "groups": groups };
};

const ARGS_GET_USERS_BY_ID = {};
ARGS_GET_USERS_BY_ID.ids = typecheck.array_of_type(typecheck.string_uid);
ARGS_GET_USERS_BY_ID.last_mod_seq = typecheck.multicheck([typecheck.integer, typecheck.nonnegative]);

crpc_functions.get_users_by_id = async (connection, args) => {
    typecheck.validate_object_structure(args, ARGS_GET_USERS_BY_ID);

    const self_uid = await connection.get_user();

    const ids = args.ids.filter( () => true ); 		// make array dense: remove any elem which is unset

    if (ids.length === 0) {
        return { "users": [] };
    }

    let paramnr = 2;
    const callparams = ids.map( () => "$"+(paramnr++) ).join(",");

    const users = (await connection.db.query(
        `
        with users_of_groups_of_user as (
            select users.*
            from
                users,
                group_memberships as gm1,
                group_memberships as gm2
            where
                users.id = gm1.uid and
                gm1.gid = gm2.gid and
                gm2.uid = $1 and
                users.id in (${callparams})
        ), max_last_mod_seq as (
            select max(last_mod_seq) as max_last_mod_seq from users_of_groups_of_user
        )
        select distinct
            id,
            name,
            added,
            added_by,
            max_last_mod_seq
        from
            users_of_groups_of_user, max_last_mod_seq
        order by
            id
        ;
        `,
        [self_uid].concat(ids)
    )).rows;

    return { "users": users };
};

const main = async() => {
    await websocket_server(on_open, crpc_functions, on_close);
};

main().then(() => console.log("server is running"));
