"use strict";

/**
 * Scope of this file:
 * 
 * Retrieving, updating, deleting and entering entries into the database.
 * Sending emails and checking passwords.
 * 
 * Not scope of this file:
 * 
 * Input validation.
 */

// TODO: check rowCount for all UPDATE statement results

const querystring = require("querystring");

const PGClient = require("pg").Client;
const bcrypt = require("bcrypt");

const util = require("./util.js");
const config = require("./config.js");
const mail = require("./mail.js");

class DB {
    constructor() {
        this.pgclient = new PGClient(config.database);
        this.callbacks = {};
        this.pgclient.on("notification", msg => this.callbacks[msg.channel](msg.payload));
    }

    /* connects to the database */
    async connect() {
        await this.pgclient.connect();
    }

    /* disconnects from the database */
    async end() {
        await this.pgclient.end();
    }

    async query(query, args) {
        // console.log("query", query, args);
        return await this.pgclient.query(query, args);
    }

    /* drops all existing tables and creates all tables as required */
    async factory_reset() {
        await this.query("drop owned by abrechnung cascade;");
        await this.query(await util.read_file(__dirname + "/database_setup.sql", "utf-8"));
    }

    /* sets a callback which is executed when a certain notification has been received */
    async listen(notification_topic, callback) {
        this.callbacks[notification_topic] = async () => {
            // we need to catch this exception because it would otherwise become an unhandled promise rejection
            try {
                await callback();
            } catch (exception) {
                console.log(exception);
                // FIXME: ignore error for now
            }
        };

        // listen doesn't support prepared statements.
        if (!util.is_string_safe(notification_topic)) {
            throw new Error("illegal unsafe notification topic name " + JSON.stringify(notification_topic));
        }
        await this.query("listen " + notification_topic);
    }

    /* removes a callback that has been prevoiusly set */
    async unlisten(notification_topic) {
        // unlisten doesn't support prepared statements.
        if (!util.is_string_safe(notification_topic)) {
            throw new Error("illegal unsafe notification topic name " + JSON.stringify(notification_topic));
        }
        await this.query("unlisten " + notification_topic);

        delete this.callbacks[notification_topic];
    }

    async add_user(id, name, email, added_by) {
        const insert_result = await this.query("insert into users (id, name, email, added_by) values ($1, $2, $3, $4) on conflict do nothing;", [id, name, email, added_by]);
        if (insert_result.rowCount !== 1) {
            // user already exists
            // FIXME:
            //   we should probably give some feedback
            //   But do not treat it as an error as
            //   * the more users exists the more conflicts on name will arise
            //   * several users may try to invite the same person in parallel
            return;
        }
        let mail_text;
        if (added_by) {
            mail_text = `you have chosen, or been chosen (by ${added_by}), to join ${config.service.name}.`;
        } else {
            mail_text = `you have chosen, or been chosen, to join ${config.service.name}.`;
        }

        if (email !== null) {
            await this.add_set_password_token(
                id,
                email,
                `Welcome to ${config.service.name}`,
                mail_text
            );
        }
    }

    async update_user_name(id, name) {
        await this.query("update users set name = $1 where id = $2", [name, id]);
    }

    async request_update_user_email(id, email) {
        const token = util.random_string(32);
        const old_email = (await this.query("select email from users where id = $1", [id])).rows[0].email;

        await this.query("update users set email_update_request = $1, email_update_request_timestamp = now(), email_update_request_token = $2 where id = $3", [email, token, id]);

        mail.send_mail(
            id,
            email,
            "Email update request",
            `you have requested to change your email address from ${old_email} to ${email}.

Please confirm here: ${config.service.url}/update_email.html?uid=${querystring.escape(id)}&update_email_token=${querystring.escape(token)}`
        );

        mail.send_mail(
            id,
            email,
            "Email update request",
            `somebody has requested to change your email address from ${old_email} to ${email}.

If that wasn't you, you'd better hurry up to login, change your password and cancel the request: ${config.service.url}.`
        );
    }

    async add_set_password_token(id, email, mail_subject, mail_text) {
        const token = util.random_string(32);
        await this.query("insert into set_password_tokens (uid, token) values ($1, $2) on conflict (uid) do update set token = $2, sent = now();", [id, token]);

        mail.send_mail(
            id,
            email,
            mail_subject,
            `${mail_text}

Please set a login password: ${config.service.url}/set_password.html?uid=${querystring.escape(id)}&set_password_token=${querystring.escape(token)}`
        );
    }

    async validate_set_password_token(id, token) {
        const result = await this.query("select sent from set_password_tokens where uid = $1 and token = $2;", [id, token]);
        if (result.rowCount === 0) {
            throw Error("bad uid or token");
        }
        return { sent: result.rows[0].sent };
    }

    async pop_set_password_token(id, token) {
        const result = await this.query("delete from set_password_tokens where uid = $1 and token = $2", [id, token]);
        if (result.rowCount !== 1) {
            throw Error("bad uid or token");
        }
    }

    async add_auth_token(uid, device_id, token) {
        await this.query("insert into auth_tokens (uid, device_id, token) values ($1, $2, $3) on conflict (uid, device_id) do update set token = $3;", [uid, device_id, token]);
    }

    async check_auth_token(uid, device_id, token) {
        const query_result = await this.query("select token from auth_tokens where uid = $1 and device_id = $2;", [uid, device_id]);
        if (query_result.rows[0] === undefined) {
            throw new Error("unknown user or device");
        }
        if (query_result.rows[0].token !== token) {
            throw new Error("bad token");
        }
        // TODO performance: awaiting this future is not necessarily required.
        await this.query("update auth_tokens set last_use = now() where uid = $1 and device_id = $2;", [uid, device_id]);
    }

    async delete_auth_token(uid, device_id) {
        await this.query("delete from auth_tokens where uid = $1 and device_id = $2", [uid, device_id]);
    }

    async set_password(uid, password) {
        const salt = await bcrypt.genSalt();
        const pwhash = await bcrypt.hash(password, salt);
        await this.query("update users set password_hash = $2, password_set = now() where id = $1", [uid, pwhash]);

        const email = (await this.query("select email from users where id = $1", [uid])).rows[0].email;

        mail.send_mail(
            uid,
            email,
            "Password change",
            "your password was changed. If that wasn't you, tough luck."
        );
    }

    async check_user_password(uid, password) {
        const query_result = await this.query("select password_hash from users where id = $1", [uid]);

        if (query_result.rows[0] === undefined) {
            throw new Error("unknown user");
        }

        const pwhash = query_result.rows[0].password_hash;

        if (pwhash === null) {
            throw new Error("user has no password set");
        }

        if (!await bcrypt.compare(password, pwhash)) {
            throw new Error("username or password incorrect");
        }
    }

    async check_update_email_token(uid, update_email_token) {
        const result = await this.query("select email, email_update_request, email_update_request_timestamp from users where id = $1 and email_update_request_token = $2", [uid, update_email_token]);

        if (result.rowCount !== 1) {
            throw Error("bad uid or token");
        }

        return {
            old_email: result.rows[0].email,
            new_email: result.rows[0].email_update_request,
            request_date: result.rows[0].email_update_request_timestamp
        };
    }

    async confirm_update_email(uid, update_email_token) {
        const result = await this.query(`
            update
                users
            set
                email = email_update_request,
                email_update_request = null,
                email_update_request_token = null,
                email_update_request_timestamp = null
            where
                id = $1 and
                email_update_request_token = $2 and
                email_update_request is not null
            ;
        `, [uid, update_email_token]);

        if (result.rowCount !== 1) {
            throw Error("Failed to update email");
        }

        const email = (await this.query("select email from users where id = $1", [uid])).rows[0].email;

        mail.send_mail(
            uid,
            email,
            "Email update confirmation",
            "we are proud to inform you that your email update was successful."
        );
    }

    async abort_update_email(uid) {
        const emails = (await this.query("select email, email_update_request from users where id = $1;", [uid])).rows[0];

        const result = await this.query(`

            update
                users
            set
                email_update_request = null,
                email_update_request_token = null,
                email_update_request_timestamp = null
            where
                id = $1 and
                email_update_request is not null
            ;
        `, [uid]);

        if (result.rowCount !== 1) {
            throw Error("No pending email update");
        }

        for (const email of [emails.email, emails.email_update_request])
        {
            console.log(email);

            if (email === null) { continue; }
            mail.send_mail(
                uid,
                email,
                "Email update aborted",
                "congratulations! You have aborted your email update."
            );
        }
    }

    async add_group(name, created_by) {
        const inserted_group = await this.query("select add_group($1, $2);", [name, created_by]);
        return inserted_group;
    }

    async add_user_to_group(uid, gid, added_by, role, accepted='pending') {
        const inserted_membership = await this.query("select add_user_to_group($1, $2, $3, $4, $5);", [uid, gid, added_by, role, accepted]);
        return inserted_membership;
    }
};

module.exports = () => new DB();
