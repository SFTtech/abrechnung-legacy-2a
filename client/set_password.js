var client;

const connect = () => {
    page.status("Connecting...");

    client = new WSClient("wss://abrechnungng.sft.mx:4333", "abrechnung-ng", {
        connect: async () => {
            page.status("Validating token...")
            try {
                const result = await client.crpc("validate_set_password_token", {
                    uid: query.uid,
                    set_password_token: query.set_password_token
                });
                page.status(`You have been prompted to set a password for ${query.uid} at ${new Date(result.sent).toString()}.`);
                page.show_set_password_prompt();
            } catch (error) {
                page.status("Token validation failed: " + error, "error");
            }
        },
        disconnect: (error) => {
            page.status("Connection closed: " + error.reason, "error");
        }
    }, true);
};

const set_password = async (password, password_confirm) => {
	try {
		if (password !== password_confirm) {
			throw Error("passwords do not match");
		}
		await client.crpc("set_password", {
			uid: query.uid,
			set_password_token: query.set_password_token,
			password: password
		});
		page.status("Password has been set");
        page.hide_set_password_prompt();
        page.show_success_message();
	} catch (error) {
		page.status("Could not set password: " + error, "error");
	}
};
