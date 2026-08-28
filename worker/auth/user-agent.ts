export function parseUserAgent(
  userAgent: string | null,
): { device: string; browser: string; os: string } {
  if (!userAgent) {
    return { device: "Unknown device", browser: "Unknown", os: "Unknown" };
  }

  let browser = "Unknown";
  let os = "Unknown";
  let device = "Desktop";

  if (/iPhone/.test(userAgent)) {
    os = "iOS";
    device = "iPhone";
  } else if (/iPad/.test(userAgent)) {
    os = "iPadOS";
    device = "iPad";
  } else if (/Android/.test(userAgent)) {
    os = "Android";
    device = "Android";
  } else if (/Mac OS X/.test(userAgent)) {
    os = "macOS";
    device = "Mac";
  } else if (/Windows/.test(userAgent)) {
    os = "Windows";
    device = "PC";
  } else if (/Linux/.test(userAgent)) {
    os = "Linux";
    device = "Linux";
  }

  if (/Edg/.test(userAgent)) browser = "Edge";
  else if (/Chrome/.test(userAgent) && /Safari/.test(userAgent)) browser = "Chrome";
  else if (/Firefox/.test(userAgent)) browser = "Firefox";
  else if (/Safari/.test(userAgent)) browser = "Safari";

  return { device, browser, os };
}
