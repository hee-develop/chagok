import { createApp, type AppOptions } from '../src/app.js';
import { loadDayFixture, loadFamilyMembers, loadMockCalendars, loadPlacesCatalog } from '../src/fixtures.js';

export const calendars = loadMockCalendars();
export const fixture = loadDayFixture(undefined, calendars);
export const catalog = loadPlacesCatalog();
export const familyMembers = loadFamilyMembers();

/** 기본 픽스처로 앱을 새로 만든다. 저장소는 호출마다 따로다. */
export const newApp = (overrides: Partial<AppOptions> = {}) => createApp({ fixture, calendars, places: catalog, familyMembers, ...overrides });
