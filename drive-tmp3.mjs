import { chromium } from "playwright";

const scratch = "C:\\Users\\HARIGO~1\\AppData\\Local\\Temp\\claude\\c--Users-Harigovind-Desktop-sites-dealerterminal\\bce320cd-ba9b-44f8-9228-b370b98ef2f2\\scratchpad\\";
const browser = await chromium.launch();
const page = await browser.newPage();
const shot = (name) => page.screenshot({ path: scratch + name + ".png" });

page.on("console", (msg) => { if (msg.type() === "error") console.log("[console:error]", msg.text()); });
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto("http://localhost:4100/login");
await page.fill('input[autocomplete="username"]', "admin");
await page.fill('input[autocomplete="current-password"]', "CFbT&zSvfHSPpSbF");
await page.click('button[type="submit"]');
await page.waitForURL("http://localhost:4100/", { timeout: 10000 });

// seed a client and a dealer so Danger Zone buttons appear
await page.click('button:has-text("Dealers")');
await page.waitForTimeout(400);
await page.fill('input[placeholder="New dealer name"]', "Seed Dealer");
await page.click('button:has-text("Add dealer")');
await page.waitForTimeout(600);

await page.click('button:has-text("Clients")');
await page.waitForTimeout(400);
await page.click('button:has-text("Add client")');
await page.waitForTimeout(300);
await page.fill('input[placeholder="Client code"]', "SEED001");
await page.fill('input[placeholder="Client name"]', "Seed Client");
await page.locator('button:has-text("Save")').click();
await page.waitForTimeout(600);
await shot("d1-clients-seeded");

// Clients danger zone
let bodyText = await page.locator("body").innerText();
console.log("[test] clients danger zone visible:", bodyText.includes("Remove all clients"));
await page.click('button:has-text("Remove all clients")');
await page.waitForTimeout(300);
await shot("d2-clients-danger-open");

// confirm button should be disabled until correct text typed
const confirmBtn = page.locator('button:has-text("Confirm — this cannot be undone")');
const disabledBefore = await confirmBtn.isDisabled();
console.log("[test] confirm disabled before typing:", disabledBefore);

const dzInput = page.locator('div:has-text("Type") input').last();
await dzInput.fill("wrong");
await page.waitForTimeout(200);
const disabledWrong = await confirmBtn.isDisabled();
console.log("[test] confirm disabled with wrong text:", disabledWrong);

await dzInput.fill("DELETE");
await page.waitForTimeout(200);
const enabledCorrect = await confirmBtn.isEnabled();
console.log("[test] confirm enabled with DELETE typed:", enabledCorrect);

await confirmBtn.click();
await page.waitForTimeout(800);
bodyText = await page.locator("body").innerText();
console.log("[test] clients wipe toast:", bodyText.includes("All clients removed"));
console.log("[test] no clients row now:", bodyText.includes("No clients yet"));
await shot("d3-clients-wiped");

// Dealers danger zone
await page.click('button:has-text("Dealers")');
await page.waitForTimeout(400);
bodyText = await page.locator("body").innerText();
console.log("[test] dealers danger zone visible:", bodyText.includes("Remove all dealers"));
await page.click('button:has-text("Remove all dealers")');
await page.waitForTimeout(300);
const dzInput2 = page.locator('div:has-text("Type") input').last();
await dzInput2.fill("DELETE");
await page.locator('button:has-text("Confirm — this cannot be undone")').click();
await page.waitForTimeout(800);
bodyText = await page.locator("body").innerText();
console.log("[test] dealers wipe toast:", bodyText.includes("All dealers removed"));
await shot("d4-dealers-wiped");

// Users section
await page.click('button:has-text("Targets")');
await page.waitForTimeout(600);
bodyText = await page.locator("body").innerText();
console.log("[test] users table shows admin+viewer:", bodyText.includes("admin") && bodyText.includes("viewer"));
console.log("[test] users danger zone visible:", bodyText.includes("Remove all other users"));
await shot("d5-users-section");

await page.click('button:has-text("Remove all other users")');
await page.waitForTimeout(300);
const dzInput3 = page.locator('div:has-text("Type") input').last();
await dzInput3.fill("DELETE");
await page.locator('button:has-text("Confirm — this cannot be undone")').click();
await page.waitForTimeout(1000);
bodyText = await page.locator("body").innerText();
console.log("[test] users wipe toast:", bodyText.includes("Removed 1 other user"));
console.log("[test] viewer gone from table:", !bodyText.includes("viewer"));
console.log("[test] admin still present (self-protect):", bodyText.includes("admin"));
await shot("d6-users-wiped");

await browser.close();
