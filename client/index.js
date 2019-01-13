// stored permanently in web-local storage.
var store;

// for this session only.
var cache = {};

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
};

const connect = () => {
    page.status("Connecting...");

    client = new WSClient("wss://abrechnungng.sft.mx:4333", "abrechnung-ng", {
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
        for (added_user_update of args.added_users)
        {
            page.table_update_added_user(
                added_user_update.id,
                added_user_update.name,
                added_user_update.email,
                added_user_update.added,
                added_user_update.activated
            );
        }

        if (args.my_account) {
            page.update_my_account(
                args.my_account.id,
                args.my_account.name,
                args.my_account.email,
                args.my_account.added,
                args.my_account.added_by,
                args.my_account.password_set,
                args.my_account.email_update_request,
                args.my_account.email_update_request_timestamp
            );
        }
    };
};