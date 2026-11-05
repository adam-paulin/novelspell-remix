// The page's deferred module script (every page): the shared layout's behaviour, then the studio where the page has one. It runs
// once the document is parsed, before DOMContentLoaded, like the dev site's classic deferred main.js.
import initLayout from "./layout";
import initStudio from "./studio";
import { watchTabTitle } from "./studio/view";

watchTabTitle();
initLayout();
initStudio();
