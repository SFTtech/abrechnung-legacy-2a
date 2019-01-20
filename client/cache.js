"use strict";

const Cache = class {

    constructor(pk_fields, fields, id = "", counter = 0) {
        for (const field of pk_fields) {
            if (! fields.includes(field)) {
                throw new Error(`pk ${field} does not exist in fields`);
            }
        };

        this.pk_fields = pk_fields;
        this.fields = fields;
        this.id = id;
        this.counter = counter;
        this.map = new Map();
    }

    pk_to_key(pk) {
        return pk.join("\x00");
    }

    entry_to_key(entry) {
        return this.pk_fields.map( (field) => entry[field] ).join("\x00");
    }

    set(entry) {
        return this.map.set(this.entry_to_key(entry), entry);
    }

    get(pk) {
        return this.map.get(this.pk_to_key(pk));
    }

    has(pk) {
        return this.map.has(this.pk_to_key(pk));
    }

    reset(id = "", counter = 0) {
        this.map.clear();
        this.id = id;
        this.counter = counter;
    }

    insert_or_update(entries, counter) {
        if (this.counter >= counter) {
            return false;
        }
        for (const entry of entries) {
            this.set(entry);
        }
        this.counter = counter;
        return true;
    }

    keys() {
        return this.map.keys();
    }

    entries() {
        return this.map.entries();
    }
};

