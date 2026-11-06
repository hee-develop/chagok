import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from './theme';

export function Logo({ label }: { label: string }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      <Svg width={26} height={26} viewBox="0 0 100 100" fill="none" stroke={colors.text} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round">
        <Rect x={10} y={26} width={80} height={62} rx={8} />
        <Path d="M37 10V88M63 10V88M10 57H90" />
        <Rect x={70} y={64} width={13} height={17} rx={2.5} fill={colors.text} stroke="none" />
      </Svg>
      <Svg width={47} height={22} viewBox="0 0 212 100" fill="none" stroke={colors.text} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M32 6V16M8 24H56M32 24Q30 72 8 92M28 56L56 92M76 6V94M76 50H94" />
        <Path d="M126 8H196V28M161 34V52M118 52H204M126 70H196V95" />
      </Svg>
    </View>
  );
}
