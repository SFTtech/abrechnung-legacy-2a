'use strict';

const nodemailer = require('nodemailer');

const config = require('./config.js');

const mail_transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: (config.email.port == 465),
    auth: {
        user: config.email.user, // generated ethereal user
        pass: config.email.password // generated ethereal password
    }
});

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