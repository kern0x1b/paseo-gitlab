import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "../account";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { searchLabelsRpc, searchUsersRpc, type DetailLabel, type Person } from "../../shared/contract";
import { Button, errorText } from "./common";
import type { Styles } from "./styles";

type Ui = { theme: PluginTheme; styles: Styles };

/** Waits for the typing to stop before asking GitLab. */
function useDebounced(value: string, delayMs = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface PickerProps<Item> {
  title: string;
  open: boolean;
  onClose: () => void;
  initial: Item[];
  keyOf: (item: Item) => string;
  labelOf: (item: Item) => string;
  search: (term: string) => Promise<Item[]>;
  queryKey: readonly unknown[];
  onSave: (items: Item[]) => Promise<unknown>;
  renderChip?: (item: Item) => React.ReactNode;
  ui: Ui;
}

/**
 * Edit a set: what is selected now as removable chips, a search box, and the
 * results to toggle. Saved as a whole, the way GitLab's sidebar dropdowns do.
 */
function Picker<Item>({
  title,
  open,
  onClose,
  initial,
  keyOf,
  labelOf,
  search,
  queryKey,
  onSave,
  renderChip,
  ui,
}: PickerProps<Item>) {
  const { styles, theme } = ui;
  const [selected, setSelected] = useState<Item[]>(initial);
  const [term, setTerm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(term);

  useEffect(() => {
    if (open) {
      setSelected(initial);
      setTerm("");
      setError(null);
    }
    // Reset only when the dialog opens, not on every refetch of `initial`.
  }, [open]);

  const results = useQuery({
    queryKey: [...queryKey, debounced],
    queryFn: () => search(debounced),
    enabled: open,
  });

  const selectedKeys = new Set(selected.map(keyOf));
  const toggle = (item: Item) =>
    setSelected((current) =>
      current.some((entry) => keyOf(entry) === keyOf(item))
        ? current.filter((entry) => keyOf(entry) !== keyOf(item))
        : [...current, item],
    );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(selected);
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={title} open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        <View style={styles.chips}>
          {selected.length === 0 ? <Text style={styles.muted}>Nothing selected.</Text> : null}
          {selected.map((item) => (
            <Pressable
              key={keyOf(item)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${labelOf(item)}`}
              onPress={() => toggle(item)}
            >
              {renderChip ? (
                renderChip(item)
              ) : (
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>{labelOf(item)} ✕</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
        <TextInput
          value={term}
          onChangeText={setTerm}
          placeholder="Search…"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoFocus
          style={[styles.input, { minHeight: 0 }]}
        />
        <View style={styles.card}>
          {results.isPending ? (
            <Text style={[styles.muted, { padding: 8 }]}>Searching…</Text>
          ) : results.isError ? (
            <Text style={[styles.error, { padding: 8 }]}>{errorText(results.error)}</Text>
          ) : results.data.length === 0 ? (
            <Text style={[styles.muted, { padding: 8 }]}>No matches.</Text>
          ) : (
            results.data.map((item) => {
              const active = selectedKeys.has(keyOf(item));
              return (
                <Pressable
                  key={keyOf(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  onPress={() => toggle(item)}
                  style={({ pressed }) => [
                    styles.listRow,
                    styles.row,
                    pressed ? styles.listRowPressed : null,
                  ]}
                >
                  <Text style={[styles.text, { width: 18 }]}>{active ? "✓" : ""}</Text>
                  {renderChip ? renderChip(item) : <Text style={styles.text}>{labelOf(item)}</Text>}
                </Pressable>
              );
            })
          )}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.row}>
          <View style={styles.spacer} />
          <Button label="Cancel" onPress={onClose} styles={styles} theme={theme} />
          <Button
            label="Save"
            primary
            busy={saving}
            onPress={() => void save()}
            styles={styles}
            theme={theme}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

export function PeoplePicker({
  title,
  open,
  onClose,
  projectPath,
  initial,
  onSave,
  ui,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  projectPath: string;
  initial: Person[];
  onSave: (usernames: string[]) => Promise<unknown>;
  ui: Ui;
}) {
  const searchUsers = useRpc(searchUsersRpc);
  return (
    <Picker<Person>
      title={title}
      open={open}
      onClose={onClose}
      initial={initial}
      keyOf={(person) => person.username}
      labelOf={(person) => `@${person.username}`}
      search={async (term) => (await searchUsers({ projectPath, search: term })).users}
      queryKey={["gitlab", "users", projectPath]}
      onSave={(people) => onSave(people.map((person) => person.username))}
      renderChip={(person) => (
        <Text style={ui.styles.text}>
          {person.name} <Text style={ui.styles.muted}>@{person.username}</Text>
        </Text>
      )}
      ui={ui}
    />
  );
}

export function LabelPicker({
  open,
  onClose,
  projectPath,
  initial,
  onSave,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  initial: DetailLabel[];
  onSave: (labelIds: string[]) => Promise<unknown>;
  ui: Ui;
}) {
  const searchLabels = useRpc(searchLabelsRpc);
  return (
    <Picker<DetailLabel>
      title="Labels"
      open={open}
      onClose={onClose}
      initial={initial}
      keyOf={(label) => label.id}
      labelOf={(label) => label.title}
      search={async (term) => (await searchLabels({ projectPath, search: term })).labels}
      queryKey={["gitlab", "labels", projectPath]}
      onSave={(labels) => onSave(labels.map((label) => label.id))}
      renderChip={(label) => (
        <View style={[ui.styles.badge, { backgroundColor: label.color }]}>
          <Text style={[ui.styles.badgeLabel, { color: label.textColor }]}>{label.title}</Text>
        </View>
      )}
      ui={ui}
    />
  );
}
