// Stores the owner's 6-digit PIN as an argon2id hash in app_settings. Usage: npm run set-pin
import { db } from "@/db/client";
import { isValidPin, storePin } from "@/lib/auth/pin";

function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("set-pin needs an interactive terminal");

  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") return finish(new Error("Cancelled"));
        if (char === "\r" || char === "\n" || char === "\u0004") return finish();
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const pin = await readHidden("New PIN (6 digits): ");
  if (!isValidPin(pin)) throw new Error("PIN must be exactly 6 digits");
  const confirm = await readHidden("Repeat PIN: ");
  if (confirm !== pin) throw new Error("The two PINs do not match");
  await storePin(pin);
  console.log("PIN updated");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
