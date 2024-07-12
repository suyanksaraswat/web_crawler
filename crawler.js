import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { program } from "commander";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const crawl = async (startUrl, maxDepth) => {
  const browser = await puppeteer.launch();
  const imagesDir = path.join(__dirname, "images");
  const visitedUrls = new Set();
  const imageData = [];

  try {
    await fs.mkdir(imagesDir, { recursive: true });
  } catch (error) {
    console.error("Error creating images directory:", error);
  }

  const crawlPage = async (url, currentDepth) => {
    if (currentDepth > maxDepth || visitedUrls.has(url)) {
      return;
    }

    visitedUrls.add(url);
    console.log(`Crawling: ${url} (Depth: ${currentDepth})`);

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    try {
      await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
    } catch (error) {
      console.error(`Failed to load page: ${url}`, error);
      await page.close();
      return;
    }

    // Wait for images to load
    await page
      .waitForSelector("img", { timeout: 5000 })
      .catch(() => console.log("No img tags found or timed out"));

    const images = await page.evaluate(() => {
      return Array.from(document.images).map((img) => ({
        src: img.src,
        alt: img.alt,
        width: img.width,
        height: img.height,
      }));
    });

    console.log(`Found ${images.length} images on ${url}`);

    for (const image of images) {
      if (!image.src || !image.src.startsWith("http")) {
        console.log(`Skipping invalid image URL: ${image.src}`);
        continue;
      }

      try {
        const response = await axios.get(image.src, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Referer: url,
          },
        });

        const contentType = response.headers["content-type"];
        if (!contentType || !contentType.startsWith("image/")) {
          console.log(`Skipping non-image content: ${image.src}`);
          continue;
        }

        const extension = contentType.split("/")[1];
        const imageName = `${Date.now()}-${Math.floor(
          Math.random() * 1000
        )}.${extension}`;
        const imagePath = path.join(imagesDir, imageName);

        await fs.writeFile(imagePath, response.data);

        imageData.push({
          url: image.src,
          page: url,
          depth: currentDepth,
          filename: imageName,
          alt: image.alt,
          width: image.width,
          height: image.height,
        });

        console.log(`Downloaded: ${imageName}`);
      } catch (error) {
        console.error(`Failed to download image: ${image.src}`, error.message);
      }
    }

    if (currentDepth < maxDepth) {
      const links = await page.evaluate(() =>
        Array.from(document.links)
          .map((link) => link.href)
          .filter((href) => href.startsWith("http"))
      );

      await page.close();

      for (const link of links) {
        await crawlPage(link, currentDepth + 1);
      }
    } else {
      await page.close();
    }
  };

  try {
    await crawlPage(startUrl, 1);
  } finally {
    await browser.close();
  }

  const indexPath = path.join(imagesDir, "index.json");
  await fs.writeFile(indexPath, JSON.stringify({ images: imageData }, null, 2));

  console.log(
    `Crawling completed. Downloaded ${imageData.length} images. Results saved in the "images" folder.`
  );
};

const main = async () => {
  program
    .argument("<start_url>", "Starting URL for crawling")
    .argument("<depth>", "Crawl depth")
    .action(async (startUrl, depth) => {
      await crawl(startUrl, parseInt(depth));
    });

  await program.parseAsync(process.argv);
};

main().catch(console.error);
