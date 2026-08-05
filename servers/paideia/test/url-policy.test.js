import assert from "node:assert/strict";
import test from "node:test";

import { createPaideiaUrlPolicy } from "../src/url-policy.js";

const policy = createPaideiaUrlPolicy({
  baseUrl: "https://paideia.example.edu",
  readOrigins: ["https://paideia-programas.example.edu"],
  authHosts: ["pandora.pucp.edu.pe"]
});

test("URL policy allows only safe Paideia read endpoints", () => {
  for (const url of [
    "https://paideia.example.edu/my/courses.php",
    "https://paideia.example.edu/course/view.php?id=1",
    "https://paideia.example.edu/mod/assign/view.php?id=2",
    "https://paideia.example.edu/mod/quiz/view.php?id=3",
    "https://paideia.example.edu/mod/forum/discuss.php?d=4",
    "https://paideia.example.edu/grade/report/user/index.php?id=1",
    "https://paideia.example.edu/mod/resource/view.php?id=5",
    "https://paideia.example.edu/pluginfile.php/1/mod_resource/content/1/file.pdf"
  ]) {
    assert.equal(policy.assertNavigation(url).href, url);
  }
  assert.equal(
    policy.assertNavigation(
      "https://paideia-programas.example.edu/my/courses.php"
    ).href,
    "https://paideia-programas.example.edu/my/courses.php"
  );
  assert.equal(
    policy.assertNavigation(
      "https://paideia-programas.example.edu/course/view.php?id=8"
    ).href,
    "https://paideia-programas.example.edu/course/view.php?id=8"
  );
});

test("URL policy rejects attempts, write actions, local addresses, foreign origins, and non-https URLs", () => {
  for (const url of [
    "https://paideia.example.edu/mod/quiz/attempt.php?attempt=1",
    "https://paideia.example.edu/mod/quiz/startattempt.php?cmid=1",
    "https://paideia.example.edu/mod/assign/view.php?id=2&action=editsubmission",
    "https://paideia.example.edu/mod/quiz/view.php?id=3&action=startattempt",
    "https://localhost/course/view.php?id=1",
    "https://127.0.0.1/course/view.php?id=1",
    "https://evil.example/course/view.php?id=1",
    "http://paideia.example.edu/course/view.php?id=1"
  ]) {
    assert.throws(() => policy.assertNavigation(url), (error) => error.code === "url_not_allowed");
  }
});

test("credentials and auth redirects are limited to exact allowlisted auth origins", () => {
  assert.equal(
    policy.assertOrigin("https://paideia.example.edu/theme/styles.php"),
    "https://paideia.example.edu"
  );
  assert.equal(
    policy.assertCredentialOrigin("https://pandora.pucp.edu.pe/pucp/login").origin,
    "https://pandora.pucp.edu.pe"
  );
  assert.equal(
    policy.assertCredentialOrigin("https://paideia.example.edu/login/index.php").origin,
    "https://paideia.example.edu"
  );
  assert.equal(
    policy.assertNavigation(
      "https://paideia.example.edu/login/index.php",
      { allowAuth: true }
    ).pathname,
    "/login/index.php"
  );
  assert.throws(
    () => policy.assertCredentialOrigin("https://pandora.pucp.edu.pe.evil.example/pucp/login"),
    (error) => error.code === "url_not_allowed"
  );
  assert.throws(
    () => policy.assertOrigin("https://cdn.evil.example/script.js"),
    (error) => error.code === "url_not_allowed"
  );
});

test("wrapper file policy accepts only known Moodle file endpoints", () => {
  assert.equal(
    policy.assertFileEndpoint("https://paideia.example.edu/pluginfile.php/1/file.pdf").pathname,
    "/pluginfile.php/1/file.pdf"
  );
  assert.equal(
    policy.assertFileEndpoint("https://paideia.example.edu/mod/resource/view.php?id=4").pathname,
    "/mod/resource/view.php"
  );
  for (const url of [
    "https://paideia.example.edu/course/view.php?id=1",
    "https://paideia.example.edu/mod/url/view.php?id=2",
    "https://evil.example/pluginfile.php/1/file.pdf"
  ]) {
    assert.throws(() => policy.assertFileEndpoint(url), (error) => error.code === "url_not_allowed");
  }
});
