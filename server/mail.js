'use strict';

const nodemailer = require('nodemailer');

const config = require('./config.js');

const email_config_to_nm_config = (ec) => {
    const result = {
        host: ec.host,
        port: ec.port,
        secure: (ec.port == 465),
        requireTLS: !! ec.requireTLS
    };
    if (result.auth) {
        result.auth = ec.auth;
    }
    return result;
};

const mail_transport = nodemailer.createTransport(
    email_config_to_nm_config(config.email)
);

module.exports.send_mail = (uid, receiver, subject, text) => {
    if (receiver === null) {
        console.log(`cannot send mail to ${uid} because no email is configured`);
        return;
    }

    mail_transport.sendMail(
        {
            from: `"${config.service.name}" <${config.email.address}>`,
            to: receiver,
            subject: subject,
            text: `Beloved ${uid},

${text}

Yours eternally,
    ${config.service.name}

Diese Mail wurde maschinell erstellt und ist daher ohne Unterschrift gültig.`
        },
        (error, info) => {
            if (error) {
                console.log(error);
            } else {
                console.log('E-Mail sent', info);
            }
        }
    );
}
