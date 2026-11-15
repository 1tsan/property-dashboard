// Built into a javascript: URL. Runs on the Rightmove/Zoopla listing the user is looking at, reads the
// photo URLs already in the page and opens Reimagine with them. __ORIGIN__ is filled in by the app.
import { extractImages, encodeHandoff } from "./extract.js";

const images = extractImages(document.documentElement.innerHTML);
if (!images.length) {
  alert("Reimagine couldn't find any listing photos on this page. Open a Rightmove or Zoopla property page and try again.");
} else {
  window.open("__ORIGIN__/reimagine" + encodeHandoff({ url: location.href.split("#")[0], title: document.title, images }), "_blank");
}
