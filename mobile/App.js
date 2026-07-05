import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import ExploreScreen from './src/screens/ExploreScreen';
import DetailScreen from './src/screens/DetailScreen';
import PlannerScreen from './src/screens/PlannerScreen';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function ExploreStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="ExploreHome" component={ExploreScreen} />
      <Stack.Screen name="Detail" component={DetailScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.green700,
          tabBarInactiveTintColor: colors.text3,
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: colors.border,
            borderTopWidth: 1,
            paddingTop: 6,
            height: 60,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginBottom: 6,
          },
          tabBarIcon: ({ focused, color }) => {
            const icons = {
              Explore: focused ? 'search' : 'search-outline',
              Planner: focused ? 'restaurant' : 'restaurant-outline',
            };
            return <Ionicons name={icons[route.name]} size={22} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Explore" component={ExploreStack} />
        <Tab.Screen name="Planner" component={PlannerScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
