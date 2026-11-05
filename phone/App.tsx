import { StatusBar } from 'expo-status-bar';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

// 기획서 10장 첫 설정 순서. 지금은 자리만 잡아 두고 단계별로 구현한다.
const SETUP_STEPS = ['캘린더 연결', '자주 가는 곳', '장소 빈 일정 채우기', '말 거는 방법'];

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>차곡</Text>
      <Text style={styles.subtitle}>일정은 폰에서 읽고, 판단은 차에서 한다</Text>

      <View style={styles.steps}>
        {SETUP_STEPS.map((step, index) => (
          <Text key={step} style={styles.step}>
            {index + 1}. {step}
          </Text>
        ))}
      </View>

      <Pressable
        style={styles.button}
        onPress={() => Alert.alert('차 연결', 'QR 짝짓기는 서버(POST /pair/claim)와 함께 구현합니다.')}
      >
        <Text style={styles.buttonText}>차 연결하기</Text>
      </Pressable>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 40,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    color: '#555',
  },
  steps: {
    marginTop: 32,
    alignSelf: 'stretch',
    gap: 8,
  },
  step: {
    fontSize: 17,
  },
  button: {
    marginTop: 32,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: '#1F6FEB',
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
