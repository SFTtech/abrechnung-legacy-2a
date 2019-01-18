var client;

const connect = () => {
    page.status("Connecting...");

    const home = window.location.hostname;
    client = new WSClient(`wss://${home}:4333`, "abrechnung-ng", {
        connect: async () => {
            page.status("Validating token...")
            try {
                const result = await client.crpc("validate_update_email_token", {
                    uid: query.uid,
                    update_email_token: query.update_email_token
                });
                page.status(`You, ${query.uid}, have requested to change your email at ${new Date(result.request_date).toString()}.`);
                page.set_confirm_button_text(`Change email from ${result.old_email} to ${result.new_email}`);
                page.show_confirm_prompt();
            } catch (error) {
                page.status("Token validation failed: " + error, "error");
            }
        },
        disconnect: (error) => {
            page.status("Connection closed: " + error.reason, "error");
        }
    }, true);
};

const confirm_update_email = async () => {
	try {
		await client.crpc("confirm_update_email", {
			uid: query.uid,
			update_email_token: query.update_email_token
		});
        page.status("Email has been updated");
        page.hide_confirm_prompt();
        page.show_success_message();
	} catch (error) {
		page.status("Could not update email: " + error, "error");
	}
};
