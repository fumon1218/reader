import type { LangCode } from '../types';
import type { Chapter } from './importers';

/** 저작권이 풀린 작품의 첫 대목(맛보기). 처음 써볼 때 책이 없어도 바로 시험해 볼 수 있습니다. */
export interface Sample {
  language: LangCode;
  title: string;
  author: string;
  chapters: Chapter[];
}

export const SAMPLES: Sample[] = [
  {
    language: 'en',
    title: "Alice's Adventures in Wonderland (맛보기)",
    author: 'Lewis Carroll',
    chapters: [
      {
        title: 'Chapter I',
        paragraphs: [
          'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice “without pictures or conversations?”',
          'So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.',
          'There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, “Oh dear! Oh dear! I shall be late!”',
        ],
      },
    ],
  },
  {
    language: 'ja',
    title: '吾輩は猫である (맛보기)',
    author: '夏目漱石',
    chapters: [
      {
        title: '一',
        paragraphs: [
          '吾輩は猫である。名前はまだ無い。',
          'どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。',
        ],
      },
    ],
  },
  {
    language: 'es',
    title: 'Don Quijote de la Mancha (맛보기)',
    author: 'Miguel de Cervantes',
    chapters: [
      {
        title: 'Capítulo I',
        paragraphs: [
          'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.',
        ],
      },
    ],
  },
];
