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