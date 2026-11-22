import { type MdInline, parseMarkdown } from '@deltaguard/shared';
import { Text, View } from 'react-native';

// Renders the post-order Markdown subset (packages/shared/src/markdown.ts).

function Inline({ parts }: { parts: MdInline[] }) {
  return parts.map((p, i) => (
    <Text key={i} className={`${p.bold ? 'font-bold text-white' : ''} ${p.italic ? 'italic' : ''}`}>
      {p.text}
    </Text>
  ));
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <View className="gap-3">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const size = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base' }[b.level];
          return (
            <Text key={i} accessibilityRole="header" className={`${size} font-bold text-white`}>
              <Inline parts={b.content} />
            </Text>
          );
        }
        if (b.type === 'list') {
          return (
            <View key={i} className="gap-1.5">
              {b.items.map((item, j) => (
                <View key={j} className="flex-row gap-2">
                  <Text className="w-5 text-base leading-6 text-gold">
                    {b.ordered ? `${j + 1}.` : '•'}
                  </Text>
                  <Text className="flex-1 text-base leading-6 text-white/85">
                    <Inline parts={item} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} className="text-base leading-6 text-white/85">
            <Inline parts={b.content} />
          </Text>
        );
      })}
    </View>
  );
}
