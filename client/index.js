// stored permanently in web-local storage.
var store;

// for this session only.
var cache = {};
cache.users = new Cache(["id"], ["id", "last_mod_seq"], "last_mod_seq");
cache.added_users = new Cache(["id"], ["id", "last_mod_seq"], "last_mod_seq" );
cache.groups = new Cache(["id"], ["id", "last_mod_seq"], "last_mod_seq");
cache.group_memberships = new Cache(["uid", "gid"], ["uid", "gid", "last_mod_seq"], "last_mod_seq");
cache.enums = {};

// the websocket client
var client;

const try_login_with_token = async () => {
    if (store.last_uid === undefined || store.last_auth_token === undefined) {
        return false;
    }

    try {
        page.status("Authenticating...");
        var result = await client.crpc("login_auth_token", {
            uid: store.last_uid,
            device_id: store.device_id,
            auth_token: store.last_auth_token
        });
    } catch (error) {
        // token login failed for whatever reason.
        console.log("token login failed", error);
        return false;
    }

    page.status("");

    page.enter_main(store.last_uid);
    await on_logged_in();
    return true;
};

const login_password = async (uid, password, remember) => {
    const args = {
        uid: uid,
        password: password
    }

    if (remember) {
        args.remember_device = store.device_id;
    }

    var result;
    try {
        result = await client.crpc("login_password", args);
    } catch (error) {
        page.status("Login failed: " + error, "error");
        return;
    }

    if (remember) {
        store.last_auth_token = result.auth_token;
        store.last_uid = uid;
    } else {
        delete store.last_auth_token;
        delete store.last_uid;
    }

    page.status("");
    page.enter_main(uid);
    await on_logged_in();
};

const logout = async () => {
    if (typeof store.last_uid === "string") {
        // tell the server to forget the auth token
        await client.crpc("forget_auth_token", {
            uid: store.last_uid,
            device_id: store.device_id,
        });

        // forget the auth token ourselves
        delete store.last_uid;
        delete store.last_auth_token;
    }

    window.location.reload();
};

const add_new_user = async (uid, name, email, email_confirm) => {
    if (uid === "") { throw Error("uid cannot be empty"); }
    if (name === "") { throw Error("name cannot be empty"); }
    if (email !== email_confirm) { throw Error("emails do not match"); }

    await client.crpc("add_new_user", {
        uid: uid,
        name: name,
        email: email
    });
};

const update_my_account_name = async (name) => {
    if (name === "") { throw Error("name cannot be empty"); }

    await client.crpc("update_my_account_name", {
        name: name
    })
};

const update_my_account_email = async (email) => {
    if (email === "") { throw Error("email cannot be empty"); }

    await client.crpc("update_my_account_email", {
        email: email
    })
};

const abort_update_email = async () => {
    await client.crpc("abort_update_email", {});
};
    
const on_logged_in = async () => {
    await client.crpc("listen_users", {});
    await client.crpc("listen_groups", {});
    await client.crpc("listen_group_memberships", {});
};

const add_new_group = async (name) => {
    if (name === "") { throw Error("name cannot be empty"); }

    await client.crpc("add_new_group", {
        name: name,
    });
};

const invite_user_to_group = async (uid, gid, role) => {
    if (uid === "") { throw Error("uid cannot be empty"); }
    if (role === "") { throw Error("role cannot be empty"); }
    if (! Number.isInteger(gid) || gid < 0) { throw Error("selected group is bogus"); }

    roles = await get_enum_user_role();
    if (! roles.has(role)) { throw Error("role is not a valid user_role"); }

    await client.crpc("invite_user_to_group", {
        uid: uid,
        gid: gid,
        role: role
    });
};

const change_user_role = async (uid, gid, new_role) => {
    if (uid === "") { throw Error("uid cannot be empty"); }
    if (new_role === "") { throw Error("role cannot be empty"); }
    if (! Number.isInteger(gid) || gid < 0) { throw Error("selected group is bogus"); }

    const roles = await get_enum_user_role();
    if (! roles.has(new_role)) { throw Error("role is not a valid user_role"); }

    return await client.crpc("change_user_role", {
        uid: uid,
        gid: gid,
        new_role: new_role
    });
};

const get_enum_user_role = async () => {
    if (typeof cache.enums.user_role !== "object") {
        cache.enums.user_role = new Set(await client.crpc("get_enum_user_role", {}));
    }
    return cache.enums.user_role;
};

var get_enum_membership_acceptance_promise;
const get_enum_membership_acceptance  = async () => {
    if (typeof cache.enums.membership_acceptance !== "object") {
        if (! get_enum_membership_acceptance_promise) {
            get_enum_membership_acceptance_promise = client.crpc("get_enum_membership_acceptance", {});
        }
        const answer = await get_enum_membership_acceptance_promise;
        if (typeof cache.enums.membership_acceptance !== "object") {
            cache.enums.membership_acceptance = new Set(answer);
        }
    }

    return cache.enums.membership_acceptance;
};

const connect = () => {
    page.status("Connecting...");

    const home = window.location.hostname;
    console.log(`hostname: ${home}`);
    client = new WSClient(`wss://${home}:4333`, "abrechnung-ng", {
        connect: async () => {
            page.status("Attempting login with token...");
            if (!(await try_login_with_token())) {
                page.status("Please log in");
                page.show_login_prompt();
            }
        },
        disconnect: (error) => {
            page.status("Connection closed: " + error.reason, "error");
        }
    }, true);

    client.srpcs.users_update = async (args) => {
        const added_users = args.added_users;
        if (added_users.length > 0) {
            const max_last_mod_seq = added_users[0].max_last_mod_seq;
            cache.added_users.insert_or_update(added_users, max_last_mod_seq);

            for (const added_user_update of added_users) {
                page.table_update_added_user(
                    added_user_update.id,
                    added_user_update.name,
                    added_user_update.email,
                    added_user_update.added,
                    added_user_update.activated
                );
            }
        }

        const my_account = args.my_account;
        if (my_account) {
            cache.my_account = my_account;
            page.update_my_account(
                my_account.id,
                my_account.name,
                my_account.email,
                my_account.added,
                my_account.added_by,
                my_account.password_set,
                my_account.email_update_request,
                my_account.email_update_request_timestamp
            );
        }

        const users_of_groups_of_user = args.users;
        if (users_of_groups_of_user.length > 0) {
            const max_last_mod_seq = users_of_groups_of_user[0].max_last_mod_seq;
            cache.users.insert_or_update(users_of_groups_of_user, max_last_mod_seq);
            // update the selected group tab: there may be user infos
            await page.set_selected_group(page.selected_group);
        }
    };

    client.srpcs.groups_update = async (args) => {
        // updates contain at least one entry !!!
        const groups = args.groups;
        const max_last_mod_seq = groups[0].max_last_mod_seq;

        const changed_groups = cache.groups.insert_or_update(groups, max_last_mod_seq);
        if (changed_groups.length === 0) {
            return;
        }

        for (const group_update of changed_groups) {
            console.log("added groups", group_update);
        }
        page.set_selected_group(page.selected_group);
    };

    client.srpcs.group_memberships_update = async (args) => {
        // updates contain at least one entry !!!
        const group_memberships = args.group_memberships;
        const max_last_mod_seq = group_memberships[0].max_last_mod_seq;

        const changed_group_memberships = cache.group_memberships.insert_or_update(group_memberships, max_last_mod_seq);
        if (changed_group_memberships.length === 0) {
            return;
        }

        const missing_gids = new Set(group_memberships.map(
            (elem) => (elem.gid)
        ).filter(
            (elem) => (! cache.groups.has([elem.gid]))
        ));
        const missing_uids = new Set(group_memberships.map(
            (elem) => (elem.uid)
        ).filter(
            (elem) => (! cache.users.has([elem.gid]))
        ));

        let changed_groups = [];
        if (missing_gids.length > 0) {
            const missing_groups = (await client.crpc("get_groups_by_id", {
                "ids": missing_gids,
                "last_mod_seq": 0
            })).groups;

            if (missing_groups.length > 0) {
                changed_groups = cache.groups.insert_or_update(missing_groups, missing_groups[0].max_last_mod_seq);
            }
            // FIXME: check if we did not get all groups
        }

        let changed_users = [];
        if (missing_uids.length > 0) {
            const missing_users = (await client.crpc("get_users_by_id", {
                "ids": missing_uids,
                "last_mod_seq": 0
            })).users;

            if (missing_users.length > 0) {
                changed_users = cache.users.insert_or_update(missing_users, missing_users[0].max_last_mod_seq);
            }
            // we may not get all missing users, because wie don't get users invited to a group
            // who do not have accepted the invitation
        }

        for (const membership of group_memberships.sort( (elem1, elem2) => (elem1.gid - elem2.gid) )) {
            let gid = membership.gid;
            let uid = membership.uid;
            console.log("added group_membership", membership);
            if (! cache.groups.has([gid])) {
                console.log("group is missing:", gid);
            } else {
                console.log("group =", cache.groups.get([gid]));
            }
            if (! cache.users.has([uid])) {
                console.log("user is missing:", uid);
            } else {
                console.log("group =", cache.users.get([uid]));
            }
            if (uid === store.last_uid) {
                console.log("calling table.update_group for:", gid, "uid is:", uid);
                await page.table_update_group(uid, gid);
            }
        }
        page.set_selected_group(page.selected_group);
    };

};
