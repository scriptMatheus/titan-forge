
function hasSql(value) {
    // sql regex reference: http://www.symantec.com/connect/articles/detection-sql-injection-and-cross-site-scripting-attacks

    if (value === null || value === undefined) {
        return false;
    }

    var sqlRegex = new RegExp("(?:')|(?:--)|(/\\*(?:.|[\\n\\r])*?\\*/)|(\\b(select|update|and|or|delete|insert|trancate|char|into|substr|ascii|declare|exec|count|master|into|drop|execute)\\b)", "i");
    if (sqlRegex.test(value)) {
        return true;
    }

    var sql_meta = new RegExp('(%27)|(\')|(--)|(%23)|(#)', 'i');
    if (sql_meta.test(value)) {
        return true;
    }

    var sql_meta2 = new RegExp('((%3D)|(=))[^\n]*((%27)|(\')|(--)|(%3B)|(;))', 'i');
    if (sql_meta2.test(value)) {
        return true;
    }

    var sql_typical = new RegExp('w*((%27)|(\'))((%6F)|o|(%4F))((%72)|r|(%52))', 'i');
    if (sql_typical.test(value)) {
        return true;
    }

    var sql_union = new RegExp('((%27)|(\'))union', 'i');
    if (sql_union.test(value)) {
        return true;
    }

    var css_attack = new RegExp('/((\%3C)|<)((\%2F)|\/)*[a-z0-9\%]+((\%3E)|>)/i ', 'i');
    if (css_attack.test(value)) {
        return true;
    }

    return false;
}



exports.noSqlInjection = (req, res, next) => {

    var containsSql = false;
    if (req.originalUrl !== null && req.originalUrl !== undefined) {
        if (hasSql(req.originalUrl) === true) {
            containsSql = true;
        }
    }


    if (containsSql === false) {

        let body = req.body;

        if (body !== null && body !== undefined) {
            
            if (body !== null && body !== undefined) {

                if (typeof body !== 'string') {
                    body = JSON.stringify(body);
                }

                if (hasSql(body) === true) {
                    containsSql = true;
                }
            }

            if (containsSql === true) {
                res.status(403).json({
                    error: '🦟 SQL Injection detected.'
                });
            } else {
                next();
            }

        }

    } else {
        res.status(403).json({
            error: '🦟 SQL Injection detected.'
        });
    }
}


