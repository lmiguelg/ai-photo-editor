import sharp from "sharp";
import { FetchError, type SafeGetOptions, type SafeResponse, type Transport } from "./net";
import { IMAGE_HOSTS, isAllowedUrl, pageSite, type ImportSite } from "./sites";

// Mock-mode transport: serves a fixed listing page per site and generated images for
// its photo URLs. It never opens a socket.

type FixtureImage = "jpeg" | "png" | "broken";

interface FixturePhoto {
  path: string;
  image: FixtureImage;
}

const FIXTURE_PHOTOS: Record<ImportSite, FixturePhoto[]> = {
  airbnb: [
    { path: "/im/pictures/hosting/sample-living-room.jpg", image: "jpeg" },
    { path: "/im/pictures/hosting/sample-kitchen.jpg", image: "jpeg" },
    { path: "/im/pictures/hosting/sample-broken.jpg", image: "broken" },
    { path: "/im/pictures/hosting/sample-bedroom.jpg", image: "jpeg" },
    { path: "/im/pictures/hosting/sample-bathroom.jpg", image: "jpeg" },
    { path: "/im/pictures/hosting/sample-terrace.jpg", image: "jpeg" },
  ],
  booking: [
    { path: "/xdata/images/hotel/max1280x900/1001.jpg", image: "jpeg" },
    { path: "/xdata/images/hotel/max1280x900/1002.jpg", image: "jpeg" },
    { path: "/xdata/images/hotel/max1280x900/1003.jpg", image: "broken" },
    { path: "/xdata/images/hotel/max1280x900/1004.jpg", image: "png" },
    { path: "/xdata/images/hotel/max1280x900/1005.jpg", image: "jpeg" },
    { path: "/xdata/images/hotel/max1280x900/1006.jpg", image: "jpeg" },
  ],
};

const cdn = (site: ImportSite, path: string) => `https://${IMAGE_HOSTS[site]}${path}`;

/** Airbnb's page mixes attribute URLs with `/`- and `\/`-escaped JSON, like the live site. */
function airbnbPage(): string {
  const [first, second, ...rest] = FIXTURE_PHOTOS.airbnb.map((photo) => cdn("airbnb", photo.path));
  const escaped = rest.map((url) => `{"baseUrl":"${url.replaceAll("/", "\\u002F")}"}`).join(",");
  return `<!doctype html>
<html><head><title>Sample stay</title>
<meta property="og:image" content="${first}?im_w=720"></head>
<body>
<img src="${first}?im_w=720&amp;im_q=medq" alt="">
<img src="${cdn("airbnb", "/im/pictures/user/User-1/original/host.jpg")}?im_w=240" alt="Host">
<img src="https://example.com/ads/banner.jpg" alt="">
<picture><source srcset="${second.replaceAll("/", "\\/")}?im_w=960 1x"></picture>
<script type="application/json">{"photos":[${escaped}]}</script>
</body></html>
`;
}

/** Booking's page lists photos at mixed sizes, including a square thumbnail of the first. */
function bookingPage(): string {
  const urls = FIXTURE_PHOTOS.booking.map((photo) =>
    cdn("booking", photo.path.replace("/max1280x900/", "/max1024x768/")),
  );
  const thumb = cdn("booking", FIXTURE_PHOTOS.booking[0].path.replace("/max1280x900/", "/square60/"));
  return `<!doctype html>
<html><head><title>Sample hotel</title></head>
<body>
${urls.map((url) => `<img src="${url}?k=abc&amp;o=" alt="">`).join("\n")}
<img src="${thumb}?k=abc" alt="">
<img src="https://example.com/ads/banner.jpg" alt="">
</body></html>
`;
}

const PAGES: Record<ImportSite, () => string> = { airbnb: airbnbPage, booking: bookingPage };

/** A detailed checkerboard, varied per photo, that passes the prefilter. */
async function generatedImage(seed: number, format: "jpeg" | "png"): Promise<Buffer> {
  const width = 1600;
  const height = 1000;
  const cell = 12 + seed * 2;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const i = (y * width + x) * 3;
      pixels[i] = on ? 200 - seed * 5 : 60;
      pixels[i + 1] = on ? 190 : 70 + seed * 5;
      pixels[i + 2] = on ? 180 : 80;
    }
  }
  const image = sharp(pixels, { raw: { width, height, channels: 3 } });
  return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer();
}

function respond(contentType: string, body: Buffer, { maxBytes }: SafeGetOptions): SafeResponse {
  if (body.byteLength > maxBytes) throw new FetchError("Response too large");
  return { contentType, body };
}

export const fixtureTransport: Transport = async (url, options) => {
  if (!isAllowedUrl(url, options.isAllowedHost)) throw new FetchError("Blocked URL");
  const pageSiteName = pageSite(url.hostname);
  if (pageSiteName) {
    return respond("text/html; charset=utf-8", Buffer.from(PAGES[pageSiteName](), "utf8"), options);
  }
  for (const site of ["airbnb", "booking"] as const) {
    if (url.hostname !== IMAGE_HOSTS[site]) continue;
    const index = FIXTURE_PHOTOS[site].findIndex((photo) => photo.path === url.pathname);
    if (index < 0) break;
    const { image } = FIXTURE_PHOTOS[site][index];
    if (image === "broken") return respond("image/jpeg", Buffer.from("not an image", "utf8"), options);
    return respond(`image/${image}`, await generatedImage(index, image), options);
  }
  throw new FetchError("HTTP 404");
};
