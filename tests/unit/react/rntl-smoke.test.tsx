import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

test('RNTL v14 async render works', async () => {
  await render(<Text>hello</Text>);
  expect(screen.getByText('hello')).toBeTruthy();
});
