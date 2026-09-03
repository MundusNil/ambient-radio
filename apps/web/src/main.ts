import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/noto-serif-sc/chinese-simplified-200.css';
import '@fontsource/noto-serif-sc/chinese-simplified-300.css';
import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import ComponentGallery from './ComponentGallery.vue';

const gallery = new URLSearchParams(window.location.search).has('gallery');
createApp(gallery ? ComponentGallery : App).mount('#app');
