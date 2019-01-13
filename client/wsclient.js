'use strict';

class WSClient {
    constructor(url, protocol, handlers, debug) {
        this.crpc_id_ctr = 0;
        this.websocket = new WebSocket(url, protocol);
        this.pending_crpcs = {};
        this.debug = debug;
        this.srpcs = {};

        this.websocket.addEventListener("message", (message) => {
            message = JSON.parse(message.data);
            if (this.debug) { console.log("RX", message); }

            if (message.type === "srpc") {
                const srpc_task = async () => {
                    try {
                        const result = await this.srpcs[message.func](message.args);
                        if (message.id !== null) {
                            this.send({
                                type: "result",
                                id: message.id,
                                result: result || {}
                            });
                        }
                    } catch (error) {
                        if (message.id !== null) {
                            this.send({
                                type: "error",
                                id: message.id,
                                error: error.message
                            });
                        } else {
                            console.log(error);
                        }
                    }
                };
                srpc_task();
                return;
            }

            if (message.type === "error") {
                this.pending_crpcs[message.id].reject(message.error);
                delete this.pending_crpcs[message.id];
                return;
            }

            if (message.type === "result") {
                this.pending_crpcs[message.id].resolve(message.result);
                delete this.pending_crpcs[message.id];
                return;
            }
        });

        this.websocket.addEventListener("open", handlers.connect);
        this.websocket.addEventListener("error", handlers.disconnect);
        this.websocket.addEventListener("close", handlers.disconnect);
    }

    async send(object) {
        if (this.debug) { console.log("TX", object); }
        this.websocket.send(JSON.stringify(object));
    }

    async crpc(func, args) {
        const request = {};
        request.type = "crpc";
        request.id = this.crpc_id_ctr++;
        request.func = func;
        request.args = args;
        const result = passive_promise();
        this.pending_crpcs[request.id] = result;
        this.send(request);
        return await result;
    }
};