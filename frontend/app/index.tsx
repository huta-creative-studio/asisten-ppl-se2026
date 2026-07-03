import { useEffect } from "react";
import { Text, View, StyleSheet, Platform } from "react-native";

export default function Index() {
  useEffect(() => {
    if (Platform.OS === "web") {
      window.location.replace("/webapp/index.html");
    }
  }, []);

  return (
    <View style={styles.container} testID="webapp-redirect-screen">
      <Text style={styles.title}>Asisten Petugas SE2026</Text>
      <Text style={styles.subtitle}>
        Aplikasi ini adalah web app (PWA). Silakan buka melalui browser di
        alamat /webapp/index.html
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1d6b2e",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    color: "#e6eee8",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
