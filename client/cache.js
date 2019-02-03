"use strict";

const Cache = class {

    constructor(pk_fields, fields, counter_field, id = "", counter = 0) {
        for (const field of pk_fields) {
            if (! fields.includes(field)) {
                throw new Error(`pk ${field} does not exist in fields`);
            }
        };
        if (! fields.includes(counter_field)) {
            throw new Error(`counter_field ${counter_field} does not exist in fields`);
        }

        this.pk_fields = pk_fields;
        this.fields = fields;
        this.counter_field = counter_field;
        this.id = id;
        this.counter = counter;
        this.map = new Map();
    }

    pk_to_map_key(pk) {
        return pk.join("\x00");
    }

    entry_to_map_key(entry) {
        return this.pk_fields.map( (field) => entry[field] ).join("\x00");
    }

    get_counter_of_entry(entry) {
        if (! entry) {
            return -1;
        }
        return entry[this.counter_field];
    }

    /**
     * even_if_counter_is_equal means: overwrite it even if new entry and old entry have the same counter
     * This is usefull if we want to store incomplelete data
     * and later refresh it.
     * This can happen if we were not allowed to see certain fields, later were allowed
     * and we fetched updates to those records.
     */
    set(entry, even_if_counter_is_equal = false) {
        const new_counter = this.get_counter_of_entry(entry);
        const map_key = this.entry_to_map_key(entry);
        const map = this.map;
        const existing_entry = map.get(map_key);
        const existing_counter = this.get_counter_of_entry(existing_entry);
        if (
            existing_counter > new_counter ||
            (! even_if_counter_is_equal && existing_counter === new_counter)
        ) {
            return existing_entry;
        }
        return map.set(map_key, entry);
    }

    get(pk) {
        return this.map.get(this.pk_to_map_key(pk));
    }

    has(pk) {
        return this.map.has(this.pk_to_map_key(pk));
    }

    get_counter(pk) {
        return this.get_counter_of_entry(this.get(pk));
    }

    reset(id = "", counter = 0) {
        this.map.clear();
        this.id = id;
        this.counter = counter;
    }

    insert_or_update(entries, counter, even_if_entry_counter_is_equal = false) {
        let changed_entries = [];
        for (const entry of entries) {
            const new_entry = this.set(entry, even_if_entry_counter_is_equal);
            if (new_entry !== entry) {
                changed_entries.push(new_entry);
            }
        }
        this.counter = counter;
        return changed_entries;
    }

    keys() {
        return this.map.keys();
    }

    entries() {
        return this.map.entries();
    }

    values() {
        return this.map.values();
    }
};

