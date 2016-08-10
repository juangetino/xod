
import R from 'ramda';
import * as PIN_DIRECTION from '../../app/constants/pinDirection';
import * as PIN_TYPE from '../../app/constants/pinType';

/**
  * Transforms JSON data as it seen it *.xod files to
  * a shape expected by the runtime.
  */
export default function transform(project) {
  // :: () -> Patch -- joins all patches into one shallow
  const mergedPatch = R.compose(
    R.omit('id'),
    R.reduce(R.mergeWith(R.merge), {}),
    R.values,
    R.propOr({}, 'patches')
  )(project);

  // :: String -> {a} -- extacts a specific key branch from the merged patch
  const mergedEntities = key => R.propOr({}, key)(mergedPatch);

  const nodes = () => mergedEntities('nodes');

  const pins = () => mergedEntities('pins');
  const pinList = R.compose(R.values, pins);
  const pinById = id => R.propOr({}, id, pins());

  const links = () => mergedEntities('links');
  const linkList = R.compose(R.values, links);

  const nodeTypes = () => R.propOr({}, 'nodeTypes', project);
  const nodeTypeById = id => R.propOr({}, id, nodeTypes());

  // :: Node -> NodeType
  const nodeTypeByNode = R.compose(nodeTypeById, R.prop('typeId'));

  // :: NodeType -> {Key: NodeType.Pin}
  const nodeTypePins = R.propOr({}, 'pins');

  // :: String -> JSType -- converts pin string type name to native JS type object
  const nativeType = R.pipe(
    R.when(R.equals(PIN_TYPE.PULSE), R.always(Boolean)),
    R.when(R.equals(PIN_TYPE.BOOL), R.always(Boolean)),
    R.when(R.equals(PIN_TYPE.NUMBER), R.always(Number)),
    R.when(R.equals(PIN_TYPE.STRING), R.always(String))
  );

  // :: {Key: NodeType.Pin} -> {Key: NodeType.Pin}
  const filterByDirection = dir => R.filter(R.propEq('direction', dir));

  // :: NodeType -> {Key: NodeType.Pin}
  const inputs = R.compose(filterByDirection(PIN_DIRECTION.INPUT), nodeTypePins);
  const outputs = R.compose(filterByDirection(PIN_DIRECTION.OUTPUT), nodeTypePins);

  // :: NodeType -> {Key: JSType}
  const inputTypes = R.compose(
    R.map(pin => nativeType(pin.type)),
    inputs
  );

  // :: NodeType -> TransformedNodeType
  const transformedNodeType = nodeType => R.merge(
    R.pick(['pure', 'setup', 'evaluate'])(nodeType),
    R.objOf('inputTypes', inputTypes(nodeType))
  );

  // :: Link -> OutLink
  const linkDestination = R.compose(
    R.pick(['nodeId', 'key']),
    pinById,
    R.nth(1),
    R.prop('pins')
  );

  // :: Pin -> [Link]
  const outgoingLinks = (pin) => R.filter(
    R.compose(
      R.equals(pin.id),
      R.nth(0),
      R.prop('pins')
    )
  )(linkList());

  // :: NodeType.Pin -> Pin
  const pinByNodeTypePin = R.curry(
    (ownerNode, nodeTypePin) => R.compose(
      R.defaultTo({}),
      R.find(R.where({
        nodeId: R.equals(ownerNode.id),
        key: R.equals(nodeTypePin.key),
      }))
    )(pinList())
  );

  // :: NodeType.Pin -> [OutLink]
  const nodeTypePinOutLinks = ownerNode => R.compose(
    R.map(linkDestination),
    outgoingLinks,
    pinByNodeTypePin(ownerNode)
  );

  // :: Node -> [OutLink]
  const nodeOutLinks = node => R.compose(
    R.reject(R.isEmpty),
    R.map(nodeTypePinOutLinks(node)),
    outputs,
    nodeTypeByNode
  )(node);

  // :: Node -> TransformedNode
  const transformedNode = node => R.mergeAll([
    R.pick(['id'])(node),
    R.compose(transformedNodeType, nodeTypeByNode)(node),
    R.objOf('outLinks', nodeOutLinks(node)),
  ]);

  return R.map(transformedNode, nodes());
}