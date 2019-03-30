'use strict';

// contains a map of { text input: (original value of text input, button label) }
const text_input_metadata = new WeakMap();

const link_text_input_to_update_button = (text_input, button, on_click, condition_valid=(value) => (value.length > 0)) => {
    text_input_metadata.set(text_input, {
        original_value: text_input.value,
        button: button
    });

    button.addEventListener("click", () => on_click(text_input.value));
    text_input.addEventListener("keydown", (e) => {
        if (button.disabled) { return; }
        if (e.key === "Enter") { on_click(text_input.value); }
    });

    text_input.addEventListener("input", (e) => {
        button.disabled = (text_input.value === text_input_metadata.get(text_input).original_value) || !condition_valid(text_input.value);
    });
};

const assign_value_to_text_input_with_update_button = (text_input, value) => {
    const metadata = text_input_metadata.get(text_input);
    metadata.original_value = value;
    metadata.button.disabled = true;
    text_input.value = value;
};

const create_selection_if_not_exists = (id, options, selected, event_listener) => {
    let elem = document.getElementById(id);
    if (! elem) {
        elem = document.createElement("select");
        elem.setAttribute("id", id);
        elem.setAttribute("name", id);
        if (event_listener) {
            elem.addEventListener("change", event_listener);
        }
    }
    for (const option of options) {
        const option_elem_id = `${id} ${option}`;
        let option_elem = document.getElementById(option_elem_id);
        if (! option_elem) {
            option_elem = document.createElement("option");
            option_elem.setAttribute("id", option_elem_id);
            option_elem.setAttribute("value", option);
            option_elem.appendChild(document.createTextNode(option));
            elem.appendChild(option_elem);
        }
        if (option === selected) {
            option_elem.setAttribute("selected", 1);
        }
    }
    return elem;
};

const remove_all_children = (elem) => {
    let child;
    while (child = elem.lastChild) {
        elem.removeChild(child);
    }
};
