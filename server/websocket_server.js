'use strict';

const https = require('https');
const fs = require("fs");
const WebSocketServer = require('websocket').server;

const config = require('./config.js');
const DB = require("./db.js");
const passive_promise = require('./util.js').passive_promise;


module.exports = (on_open, crpc_functions, on_close) => {
    const ssl_options = config.websocket.ssl_pem_files.misc;

    try {
        ssl_options.key = fs.readFileSync(config.websocket.ssl_pem_files.key);
        ssl_options.cert = fs.readFileSync(config.websocket.ssl_pem_files.cert);
        if (config.websocket.ssl_pem_files.dhparam) {
            ssl_options.dhparam = fs.readFileSync(config.websocket.ssl_pem_files.dhparam);
        }

        var server = https.createServer(
            ssl_options,
            (req, res) => {
            res.writeHead(200);
            res.end('please connect to the websocket');
        });

        server.listen(config.websocket.port);
    } catch (error) {
        console.log("could not launch websocket server", error);
        process.exit(1);
    }

    var ws_server = new WebSocketServer({
        httpServer: server,
        // We allow connections from anywhere because auth is done via websocket.
        autoAcceptConnections: false
    });

    ws_server.on('request', async request => {
        const connection = request.accept('abrechnung-ng', request.origin);
        connection.db = DB();
        connection.info = {};
        connection.pending_srpcs = {};
        connection.srpc_id_ctr = 0;

        connection.srpc = async (func, args, expect_reply=true) => {
            // TODO DOS protection: delay SRPC if too many are open right now

            let id = null;
            let srpc_promise = null;
            if (expect_reply) {
                // we do not expect a reply.
                // send null as the id; the client will then not send a reply.
                srpc_promise = passive_promise();
                connection.pending_srpcs[connection.srpc_id_ctr] = srpc_promise;
                id = connection.srpc_id_ctr++;
            }

            connection.sendUTF(JSON.stringify({
                "type": "srpc",
                "id": id,
                "func": func,
                "args": args
            }));

            return await srpc_promise;
        };

        connection.supd = async (func, args) => {
            // update only; don't expect a reply
            return await connection.srpc(func, args, false);
        }

        // TODO DOS protection: count and limit the number of open connections for each IP.

        // TODO DOS protection: connect at some later time
        await connection.db.connect();

        await on_open(connection);
        connection.on('message', async message => {
            if (message.type !== 'utf8') {
                connection.close(1002, 'Illegal message type: ' + JSON.stringify(message.type));
                return;
            }
            try {
                message = JSON.parse(message.utf8Data);
            } catch(exception) {
                connection.close(1002, "Bad message is not valid JSON: " + exception.message);
                return;
            }

            if (message.type === "error") {
                const pending_srpc = connection.pending_srpcs[message.id];
                delete connection.pending_srpcs[message.id];

                // 'error' reply to a SRPC
                if (typeof message.error !== 'string') {
                    connection.close(1002, "Bad SRPC error message");
                }
                if (pending_srpc === undefined) {
                    connection.close(1002, "Unknown SRPC message id");
                }
                pending_srpc.reject(message.error);
                return;
            }

            if (message.type === "result") {
                // 'result' reply to a SRPC
                const pending_srpc = connection.pending_srpcs[message.id];
                delete connection.pending_srpcs[message.id];

                if (typeof message.result !== 'object' || Array.isArray(message.result)) {
                    connection.close(1002, 'Bad SRPC result message');
                }
                if (pending_srpc === undefined) {
                    connection.close(1002, 'Unknown SRPC message id');
                }
                pending_srpc.resolve(message.result);
                return;
            }

            // the message wasn't a SRPC reply; it got to be a new CRPC request.

            if (message.type !== "crpc") {
                // new CRPC call
                connection.close(1002, 'Bad message type');
            }

            if (message.id === undefined) {
                connection.close(1002, "CRPC id missing");
                return;
            }

            const crpc_function = crpc_functions[message.func];

            // TODO DOS protection: count and limit the number of open requests for each client.

            try {
                if (crpc_function === undefined) {
                    throw new Error("Unknown function " + JSON.stringify(message.func));
                }

                const result = await crpc_function(connection, message.args) || {};
                if (typeof result !== 'object' || Array.isArray(message.result)) {
                    throw new Error("Bad function result: " + JSON.stringify(result));
                }

                connection.sendUTF(JSON.stringify({
                    "type": "result",
                    "id": message.id,
                    "result": result
                }));
            } catch (exception) {
                connection.sendUTF(JSON.stringify({
                    "type": "error",
                    "id": message.id,
                    "error": exception.message
                }));
            }
        });

        connection.on('close', async (reasonCode, description) => {
            await on_close(connection, description);
            await connection.db.end();
        });
    });
};

