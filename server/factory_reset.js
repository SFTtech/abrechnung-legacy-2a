'use strict';

const readline = require('readline');

const util = require('./util.js');
const db_connection = require('./db.js');
const typecheck = require('./eval/typecheck.js');
const mail = require('./mail.js');

const get_user_details = async () => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const promisified_question = async (prompt) => {
            const result = util.passive_promise();
            rl.question(prompt, result.resolve);
            return await result;
        }

        console.log("creating first user");
        const id = await promisified_question('uid:       ');
        typecheck.validate_uid(id);

        const name = await promisified_question('name:      ');
        typecheck.validate_username(name);

        const email = await promisified_question('email:     ');
        typecheck.validate_email(email);

        const email2 = await promisified_question('and again: ');

        if (email !== email2) {
            throw Error("emails are not identical");
        }

        return [id, name, email];
    } finally {
        rl.close();
    }
};

const test = async () => {
    const db = db_connection();
    await db.connect();

    try {
        const [uid, username, email] = await get_user_details();

        await db.factory_reset();
        await db.add_user(uid, username, email, null);

        await db.listen("users", arg => console.log("users", arg));
        await db.listen("groups", arg => console.log("groups", arg));

        //const tests = await util.read_file("database_test.sql", "utf-8");
        //await db.query(tests);
    } finally {
        await db.end();
    }
}

const main = async () => {
    try {
        await test();
    } catch (error) {
        console.log(error);
    }
}

main();
