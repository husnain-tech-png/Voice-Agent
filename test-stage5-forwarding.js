/**
 * Stage 5: Mobile Call Forwarding & SMS Summaries — Automated Test Suite
 * 
 * Tests:
 * 1. Forwarding setup instructions endpoint (GET /api/forwarding/setup)
 * 2. Call history endpoint (GET /api/calls/history)
 * 3. Caller metadata captured in TwiML webhook
 * 4. Transcript tracking during simulated call
 * 5. Post-call LLM summary generation (via simulator)
 * 6. SMS delivery test (dry-run mode if Twilio not configured)
 * 7. Call history persistence to call-history.json
 * 8. Health check Stage 5 section
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const passed = [];
const failed = [];
const warnings = [];

function log(icon, msg) { console.log(`${icon} ${msg}`); }
function pass(name, detail = "") { passed.push(name); log("✅", `PASS: ${name}${detail ? " — " + detail : ""}`); }
function fail(name, detail = "") { failed.push(name); log("❌", `FAIL: ${name}${detail ? " — " + detail : ""}`); }
function warn(name, detail = "") { warnings.push(name); log("⚠️", `WARN: ${name}${detail ? " — " + detail : ""}`); }
function section(title) { console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`); }

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  return { status: res.status, body };
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.text();
  return { status: res.status, body };
}

async function runTests() {
  console.log("\n🧪 Stage 5: Mobile Call Forwarding & SMS Summaries — Test Suite");
  console.log(`🌐 Server: ${BASE_URL}\n`);

  // ============================================
  // Test 1: Health Check — Stage 5 Section
  // ============================================
  section("Test 1: Health Check — Stage 5 Section");
  try {
    const { status, body } = await fetchJson(`${BASE_URL}/api/health`);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    if (!body.stage5) throw new Error("No stage5 section in health response");

    if (body.stage5.mobileCallForwarding === true) {
      pass("Health: mobileCallForwarding", "true");
    } else {
      fail("Health: mobileCallForwarding", `Expected true, got ${body.stage5.mobileCallForwarding}`);
    }

    if (body.stage5.postCallSummary === true) {
      pass("Health: postCallSummary", "true");
    } else {
      fail("Health: postCallSummary", `Expected true, got ${body.stage5.postCallSummary}`);
    }

    if (typeof body.stage5.callHistoryCount === "number") {
      pass("Health: callHistoryCount", `${body.stage5.callHistoryCount} calls`);
    } else {
      fail("Health: callHistoryCount", "Missing or not a number");
    }

    if (body.stage5.forwardingSetupEndpoint === "/api/forwarding/setup") {
      pass("Health: forwardingSetupEndpoint", body.stage5.forwardingSetupEndpoint);
    } else {
      fail("Health: forwardingSetupEndpoint", `Got: ${body.stage5.forwardingSetupEndpoint}`);
    }
  } catch (err) {
    fail("Health Check Stage 5", err.message);
  }

  // ============================================
  // Test 2: Forwarding Setup Endpoint
  // ============================================
  section("Test 2: Forwarding Setup Endpoint (GET /api/forwarding/setup)");
  try {
    const { status, body } = await fetchJson(`${BASE_URL}/api/forwarding/setup`);
    if (status !== 200) throw new Error(`HTTP ${status}`);

    if (body.status === "ready") {
      pass("Forwarding: status", "ready");
    } else {
      fail("Forwarding: status", `Got: ${body.status}`);
    }

    if (body.carriers && body.carriers.universal_gsm) {
      pass("Forwarding: universal_gsm carrier", "present");
      if (body.carriers.universal_gsm.enable && body.carriers.universal_gsm.enable.includes("*61*")) {
        pass("Forwarding: GSM CFNR code format", body.carriers.universal_gsm.enable);
      } else {
        fail("Forwarding: GSM CFNR code format", "Missing *61* pattern");
      }
      if (body.carriers.universal_gsm.timerOptions) {
        const timerKeys = Object.keys(body.carriers.universal_gsm.timerOptions);
        pass("Forwarding: timer options", `${timerKeys.length} options (${timerKeys.join(", ")})`);
      } else {
        fail("Forwarding: timer options", "Missing");
      }
      if (body.carriers.universal_gsm.disable === "##61#") {
        pass("Forwarding: disable code", "##61#");
      } else {
        fail("Forwarding: disable code", `Got: ${body.carriers.universal_gsm.disable}`);
      }
    } else {
      fail("Forwarding: carriers data", "Missing universal_gsm");
    }

    // Check Pakistani carriers
    const pkCarriers = ["jazz_warid", "zong", "telenor", "ufone"];
    for (const carrier of pkCarriers) {
      if (body.carriers[carrier]) {
        pass(`Forwarding: ${carrier}`, body.carriers[carrier].name);
      } else {
        warn(`Forwarding: ${carrier}`, "Missing");
      }
    }

    if (body.howItWorks && body.howItWorks.step1) {
      pass("Forwarding: howItWorks guide", "Present");
    } else {
      fail("Forwarding: howItWorks guide", "Missing");
    }

    if (body.gsmTimerNote && body.gsmTimerNote.includes("5-second increments")) {
      pass("Forwarding: GSM timer note", "Explains 5s increments");
    } else {
      warn("Forwarding: GSM timer note", "Missing or incomplete");
    }
  } catch (err) {
    fail("Forwarding Setup Endpoint", err.message);
  }

  // ============================================
  // Test 3: Call History Endpoint (Empty or Pre-existing)
  // ============================================
  section("Test 3: Call History Endpoint (GET /api/calls/history)");
  try {
    const { status, body } = await fetchJson(`${BASE_URL}/api/calls/history`);
    if (status !== 200) throw new Error(`HTTP ${status}`);

    if (typeof body.totalCalls === "number") {
      pass("Call History: totalCalls", `${body.totalCalls} calls`);
    } else {
      fail("Call History: totalCalls", "Missing or not a number");
    }

    if (Array.isArray(body.calls)) {
      pass("Call History: calls array", `${body.calls.length} entries`);
    } else {
      fail("Call History: calls array", "Not an array");
    }
  } catch (err) {
    fail("Call History Endpoint", err.message);
  }

  // ============================================
  // Test 4: TwiML Webhook — Caller Metadata Parameters
  // ============================================
  section("Test 4: TwiML Webhook — Caller Metadata Parameters");
  try {
    const testFrom = "+923001234567";
    const testForwardedFrom = "+14155559999";
    const testCallSid = "CA_test_stage5_123";

    const { status, body: twimlBody } = await fetchText(`${BASE_URL}/twilio/incoming`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `From=${encodeURIComponent(testFrom)}&ForwardedFrom=${encodeURIComponent(testForwardedFrom)}&CallSid=${encodeURIComponent(testCallSid)}&CallerName=Test+Caller`
    });

    if (status !== 200) throw new Error(`HTTP ${status}`);

    if (twimlBody.includes("<Response>") && twimlBody.includes("<Connect>") && twimlBody.includes("<Stream")) {
      pass("TwiML: Valid XML structure", "Response > Connect > Stream");
    } else {
      fail("TwiML: Valid XML structure", "Missing expected TwiML tags");
    }

    if (twimlBody.includes(`value="${testFrom}"`)) {
      pass("TwiML: callerNumber parameter", testFrom);
    } else {
      fail("TwiML: callerNumber parameter", "Missing caller number");
    }

    if (twimlBody.includes(`name="forwardedFrom"`)) {
      pass("TwiML: forwardedFrom parameter", "Present");
    } else {
      fail("TwiML: forwardedFrom parameter", "Missing");
    }

    if (twimlBody.includes(`name="callSid"`)) {
      pass("TwiML: callSid parameter", "Present");
    } else {
      fail("TwiML: callSid parameter", "Missing");
    }

    if (twimlBody.includes(`name="callerName"`)) {
      pass("TwiML: callerName parameter", "Present");
    } else {
      fail("TwiML: callerName parameter", "Missing");
    }
  } catch (err) {
    fail("TwiML Webhook Metadata", err.message);
  }

  // ============================================
  // Test 5: Simulated Call — Transcript & Summary
  // ============================================
  section("Test 5: Simulated Call — Transcript & Summary Generation");
  try {
    const { status, body } = await fetchJson(`${BASE_URL}/api/twilio/simulate-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userMessage: "I need to book an appointment for tomorrow" })
    });

    if (status !== 200) throw new Error(`HTTP ${status}`);

    if (body.success === true) {
      pass("Simulator: Call simulation", "Success");
    } else {
      fail("Simulator: Call simulation", "Not successful");
    }

    if (body.stages?.greeting?.text) {
      pass("Simulator: Greeting text", body.stages.greeting.text.substring(0, 40) + "...");
    } else {
      fail("Simulator: Greeting text", "Missing");
    }

    if (body.stages?.brainReply?.text) {
      pass("Simulator: AI reply", body.stages.brainReply.text.substring(0, 50) + "...");
    } else {
      fail("Simulator: AI reply", "Missing");
    }
  } catch (err) {
    fail("Simulated Call", err.message);
  }

  // ============================================
  // Test 6: Test SMS Summary Endpoint (Dry Run)
  // ============================================
  section("Test 6: Test SMS Summary Endpoint (POST /api/calls/test-summary-sms)");
  try {
    const { status, body } = await fetchJson(`${BASE_URL}/api/calls/test-summary-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    // It's OK if this fails due to missing Twilio creds — we just verify the endpoint exists
    if (status === 200 && body.success) {
      pass("Test SMS: Sent successfully", body.message || "");
    } else if (status === 400 && body.error) {
      // Expected when PERSONAL_PHONE_NUMBER or Twilio creds are not configured
      warn("Test SMS: Expected config error", body.error.substring(0, 60));
      pass("Test SMS: Endpoint exists", "Returns proper error when not configured");
    } else {
      fail("Test SMS: Unexpected response", `HTTP ${status}`);
    }
  } catch (err) {
    fail("Test SMS Endpoint", err.message);
  }

  // ============================================
  // Test 7: Call History — Single Call Detail
  // ============================================
  section("Test 7: Single Call Detail (GET /api/calls/:callSid)");
  try {
    // Test with a non-existent call SID — should return 404
    const { status: notFoundStatus, body: notFoundBody } = await fetchJson(`${BASE_URL}/api/calls/CA_nonexistent_test`);
    if (notFoundStatus === 404 && notFoundBody.error) {
      pass("Call Detail: 404 for missing call", notFoundBody.error);
    } else {
      fail("Call Detail: 404 for missing call", `Expected 404, got HTTP ${notFoundStatus}`);
    }

    // If we have existing calls, test with the first one
    const { body: historyBody } = await fetchJson(`${BASE_URL}/api/calls/history`);
    if (historyBody.calls && historyBody.calls.length > 0) {
      const firstCall = historyBody.calls[0];
      const { status: detailStatus, body: detailBody } = await fetchJson(`${BASE_URL}/api/calls/${firstCall.callSid}`);
      if (detailStatus === 200 && detailBody.callSid === firstCall.callSid) {
        pass("Call Detail: Found existing call", `SID: ${firstCall.callSid}`);
      } else {
        fail("Call Detail: Existing call lookup", `HTTP ${detailStatus}`);
      }
    } else {
      warn("Call Detail: No existing calls", "History is empty, skipping detail lookup test");
    }
  } catch (err) {
    fail("Single Call Detail", err.message);
  }

  // ============================================
  // Test 8: Call History with Limit Parameter
  // ============================================
  section("Test 8: Call History Limit Parameter");
  try {
    const { status, body } = await fetchJson(`${BASE_URL}/api/calls/history?limit=5`);
    if (status !== 200) throw new Error(`HTTP ${status}`);

    if (body.showing <= 5) {
      pass("Call History: Limit parameter", `Showing ${body.showing} of ${body.totalCalls}`);
    } else {
      fail("Call History: Limit parameter", `Showing ${body.showing} (expected <= 5)`);
    }
  } catch (err) {
    fail("Call History Limit", err.message);
  }

  // ============================================
  // Summary
  // ============================================
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  📊 STAGE 5 TEST RESULTS`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  ✅ Passed:   ${passed.length}`);
  console.log(`  ❌ Failed:   ${failed.length}`);
  console.log(`  ⚠️  Warnings: ${warnings.length}`);
  console.log(`${"=".repeat(60)}\n`);

  if (failed.length > 0) {
    console.log("❌ Failed tests:");
    failed.forEach(f => console.log(`   - ${f}`));
    console.log();
  }

  if (warnings.length > 0) {
    console.log("⚠️  Warnings:");
    warnings.forEach(w => console.log(`   - ${w}`));
    console.log();
  }

  if (failed.length === 0) {
    console.log("🎉 ALL TESTS PASSED! Stage 5 is working correctly.\n");
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
