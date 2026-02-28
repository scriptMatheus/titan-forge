require('dotenv').config();
const jwt = require('jsonwebtoken')
const tokenSecret = process.env.SECRET;

exports.verificaToken = (req, res, next) => {
    const token = req.headers["api-key"];

    if (!token) {
        res.status(401).json({ error: "missing token" })
    }
    else {

        jwt.verify(token, tokenSecret, (err, value) => {

            if (err) {

                res.status(401).json({ error: 'invalid token' })

            } else {

                next();

            }
        })

    }
}